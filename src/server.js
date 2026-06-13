// LINE Messaging API webhook for the no-AI menu-navigation manual bot.
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { middleware, messagingApi } from "@line/bot-sdk";

import {
  buildLangPicker,
  buildLangSet,
  buildMenu,
  handlePostback,
  routeText,
  buildHandoffMessage,
  shouldReassure,
  langFromText,
} from "./messages.js";
import { notifyHandoff } from "./notify.js";
import { startReportScheduler } from "./scheduler.js";
import { normLang, t } from "./content.js";
import { config } from "./config.js";
import { createUserStore } from "./store/user-store.js";
import { logInbound, logOutbound } from "./event-log.js";
import { validate } from "./validate.js";

// Refuse to boot if committed artifacts are inconsistent. The same checks run
// in the build gate, so this is a belt-and-braces guard for cases where the
// server is started with stale data (e.g. deploy that missed `npm run build`).
{
  const { fails, warns } = validate();
  for (const w of warns) console.warn("warn:", w);
  if (fails.length) {
    for (const f of fails) console.error("fail:", f);
    console.error(
      `\nRefusing to start: ${fails.length} content validation failure(s). ` +
      `Run \`npm run build\` to regenerate.`
    );
    process.exit(1);
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = config.server.port;
const BASE_URL = config.server.baseUrl;
const channelSecret = process.env.CHANNEL_SECRET || "";
const channelAccessToken = process.env.CHANNEL_ACCESS_TOKEN || "";
if (!channelSecret || !channelAccessToken) {
  console.error(
    "Refusing to start: CHANNEL_SECRET and CHANNEL_ACCESS_TOKEN must be set " +
    "(LINE Developers console → Messaging API channel)."
  );
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({ channelAccessToken });
const app = express();

// Per-user state goes through the UserStore seam — adapter chosen by env.
const userStore = createUserStore();

function getLang(event) {
  const uid = event.source?.userId;
  return normLang(uid ? userStore.get(uid, "lang") : undefined);
}
async function setLang(event, lang) {
  const uid = event.source?.userId;
  if (uid) await userStore.set(uid, "lang", normLang(lang));
}

// Per-user handoff state: timestamp (ms) of the last handoff, so the "a human
// will reply" reassurance is sent at most once per support episode.
const HANDOFF_KEY = "handoffAt";
const HANDOFF_COOLDOWN_MS = config.handoff.reassureCooldownMin * 60_000;

async function clearHandoff(event) {
  const uid = event.source?.userId;
  if (uid) await userStore.set(uid, HANDOFF_KEY, 0); // resolved → next problem reassures
}

// Resolve a user's LINE display name, cached in the store so we call the
// Profile API at most once per user. Returns undefined if unknown (e.g. the
// user hasn't added the OA) — the alert then falls back to the userId.
async function resolveName(uid) {
  if (!uid) return undefined;
  const cached = userStore.get(uid, "name");
  if (cached) return cached;
  try {
    const { displayName } = await client.getProfile(uid);
    if (displayName) await userStore.set(uid, "name", displayName);
    return displayName;
  } catch (e) {
    console.warn("getProfile failed:", e?.message || e);
    return undefined;
  }
}

// Send the reassurance once per episode, alert the team every time, and slide
// the episode window forward. Returns the messages to reply with.
async function handleHandoff(event, text, routed, lang) {
  const uid = event.source?.userId;
  const now = Date.now();
  const lastAt = uid ? Number(userStore.get(uid, HANDOFF_KEY)) || 0 : 0;
  const fresh = shouldReassure(lastAt, now, HANDOFF_COOLDOWN_MS);
  if (uid) await userStore.set(uid, HANDOFF_KEY, now);
  // Resolve the name then alert — in the background so the profile lookup and
  // webhook post never delay the LINE reply (reply tokens expire).
  void resolveName(uid).then((displayName) =>
    notifyHandoff({
      userId: uid,
      displayName,
      text,
      tags: routed.tags,
      businessHours: routed.businessHours,
      followUp: !fresh,
    })
  );
  return fresh ? buildHandoffMessage(lang, routed.businessHours) : [];
}

// Serve the manual screenshots referenced by messages. Videos are hosted on
// YouTube, so no /video static mount is needed.
app.use("/img",     express.static(join(ROOT, "img")));
app.use("/preview", express.static(join(ROOT, "preview")));
app.get("/", (_req, res) => res.send("ManualFAQ LINE bot is running."));

async function messagesFor(event) {
  const lang = getLang(event);

  if (event.type === "postback") {
    const params = new URLSearchParams(event.postback.data);
    if (params.get("action") === "setlang") {
      const next = normLang(params.get("lang"));
      await setLang(event, next);
      return buildLangSet(next);
    }
    return handlePostback(event.postback.data, BASE_URL, lang);
  }

  if (event.type === "follow") {
    // First contact: greet, then let the user pick a language.
    return [{ type: "text", text: t(lang, "welcome") }, ...buildLangPicker(lang)];
  }

  // Typed text (the only way to navigate on PC, where buttons don't render).
  if (event.type === "message" && event.message.type === "text") {
    const set = langFromText(event.message.text);
    if (set) {
      await setLang(event, set);
      return buildLangSet(set);
    }
    const text = event.message.text;
    const routed = routeText(text, BASE_URL, lang);
    if (!routed.handoff) {
      // A confirmed resolution clears the open handoff so the next problem gets
      // a fresh reassurance.
      if (routed.intent === "Resolution_Closure") await clearHandoff(event);
      return routed.messages;
    }
    return handleHandoff(event, text, routed, lang);
  }
  // Non-text messages (image, sticker, video, etc.): stay silent so a human
  // admin can reply via the LINE OA console without the bot sending a menu.
  return [];
}

// The LINE middleware verifies the X-Line-Signature header using the raw body,
// so it must run before any JSON body parser on this route.
app.post("/webhook", middleware({ channelSecret }), async (req, res) => {
  try {
    await Promise.all(
      (req.body.events || []).map(async (event) => {
        logInbound(event); // every event (incl. unfollow) goes to chat history
        const messages = await messagesFor(event);
        if (!event.replyToken || !messages?.length) return;
        logOutbound(event, messages);
        return client.replyMessage({ replyToken: event.replyToken, messages });
      })
    );
    res.status(200).end();
  } catch (err) {
    console.error("webhook error:", err);
    res.status(500).end();
  }
});

// Convert LINE signature-verification failures into a clean 401.
app.use((err, _req, res, _next) => {
  if (err && err.name === "SignatureValidationFailed") {
    return res.status(401).end();
  }
  console.error(err);
  res.status(500).end();
});

app.listen(PORT, () => {
  console.log(`ManualFAQ bot listening on ${PORT} (base URL: ${BASE_URL})`);
  startReportScheduler(); // no-op unless REPORT_ENABLED=true
  if (!BASE_URL.startsWith("https://")) {
    console.warn(
      `⚠  BASE_URL is not HTTPS. LINE rejects image URLs that aren't HTTPS — ` +
        `set BASE_URL to your public https URL (e.g. the ngrok URL).`
    );
  }
});

export { app, messagesFor };
