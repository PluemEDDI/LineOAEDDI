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
import { normLang, t, init as initContent } from "./content.js";
import { init as initFaq } from "./faq.js";
import { init as initIntents } from "./intents.js";
import { config } from "./config.js";
import { createUserStore } from "./store/user-store.js";
import { logInbound, logOutbound } from "./event-log.js";
import { forwardToSheet } from "./log/sheet-forward.js";
import { validate, validateData } from "./validate.js";

// Boot validation + content loading happen inside startServer() below.

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

// Per-user admin-reply state: timestamp (ms) when an admin last manually sent
// a message to this user. While within the cooldown window, user acknowledgments
// like "ได้ครับ" / "ได้ค่ะ" are suppressed so the bot doesn't interrupt an
// ongoing human-to-human conversation.
const ADMIN_REPLY_KEY = "adminRepliedAt";
const ADMIN_COOLDOWN_MS = config.handoff.adminReplyCooldownMin * 60_000;

// Per-user bot-reply state: timestamp (ms) of the last intent-matched bot reply
// to this user. Within BOT_COOLDOWN_MS the bot stays silent on follow-ups so
// an admin has a natural window to take over without the bot cutting in.
const BOT_REPLY_KEY = "botRepliedAt";
const BOT_COOLDOWN_MS = config.handoff.botReplyCooldownMin * 60_000;

async function clearHandoff(event) {
  const uid = event.source?.userId;
  if (uid) await userStore.set(uid, HANDOFF_KEY, 0); // resolved → next problem reassures
}

// Record the timestamp when an admin manually sent a message to a user.
// Called whenever we receive a message event with no replyToken — LINE only
// issues replyTokens for messages sent by end-users, so their absence reliably
// identifies admin/OA-console messages.
async function markAdminReplied(userId) {
  if (userId) await userStore.set(userId, ADMIN_REPLY_KEY, Date.now());
}

// True if an admin replied to this user within the cooldown window, meaning
// the bot should stay silent on follow-up acknowledgments.
function isAdminReplyCooldown(userId) {
  if (!userId || !ADMIN_COOLDOWN_MS) return false;
  const lastAt = Number(userStore.get(userId, ADMIN_REPLY_KEY)) || 0;
  return lastAt > 0 && Date.now() - lastAt < ADMIN_COOLDOWN_MS;
}

// Stamp the timestamp when the bot sends an intent-matched reply so the
// post-reply cooldown window starts.
async function markBotReplied(userId) {
  if (userId && BOT_COOLDOWN_MS) await userStore.set(userId, BOT_REPLY_KEY, Date.now());
}

// True if the bot recently sent an intent-matched reply AND the post-reply
// cooldown window hasn't expired yet — meaning the admin may have jumped in
// and the bot should stay quiet.
function isBotReplyCooldown(userId) {
  if (!userId || !BOT_COOLDOWN_MS) return false;
  const lastAt = Number(userStore.get(userId, BOT_REPLY_KEY)) || 0;
  return lastAt > 0 && Date.now() - lastAt < BOT_COOLDOWN_MS;
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

// Discord "🔇 Silence bot" button handler.
// The Discord notification embed includes a button link:
//   {BASE_URL}/silence?uid=<userId>&token=<SILENCE_TOKEN>
// An admin clicking it lands here; we stamp adminRepliedAt so the bot goes
// quiet for ADMIN_REPLY_COOLDOWN_MIN minutes, then show a friendly page.
app.get("/silence", async (req, res) => {
  const { uid, token } = req.query;
  const expected = config.silence.token;

  // Reject if no token is configured (operator hasn't set SILENCE_TOKEN yet).
  if (!expected) {
    return res.status(503).send("Silence endpoint not configured (SILENCE_TOKEN unset).");
  }
  if (!token || token !== expected) {
    return res.status(403).send("Invalid or missing token.");
  }
  if (!uid) {
    return res.status(400).send("Missing uid parameter.");
  }

  await markAdminReplied(uid);
  const mins = config.silence.cooldownMin;
  console.log(`[silence] admin silenced bot for ${uid} for ${mins} min`);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot silenced</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
       min-height:100vh;margin:0;background:#1a1a2e;color:#eee;}
  .card{background:#16213e;border-radius:16px;padding:2.5rem 3rem;text-align:center;
        box-shadow:0 8px 32px #0004;max-width:380px;width:90%;}
  .icon{font-size:3rem;margin-bottom:.5rem;}
  h1{margin:.25rem 0 .75rem;font-size:1.4rem;}
  p{color:#aaa;margin:0;line-height:1.6;}
  .badge{display:inline-block;margin-top:1rem;padding:.3rem .9rem;
         background:#0f3460;border-radius:999px;font-size:.85rem;color:#7ec8e3;}
</style></head>
<body><div class="card">
  <div class="icon">🔇</div>
  <h1>Bot is now silent</h1>
  <p>The bot won't interrupt this conversation for the next <strong>${mins} minutes</strong>.<br>
     You can now reply in LINE OA freely.</p>
  <div class="badge">User: ${String(uid).slice(0, 12)}…</div>
</div></body></html>`);
});

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

  if (event.type === "message" && event.message.type === "text") {
    // LINE only issues replyTokens for end-user messages. An admin message sent
    // from the OA console arrives with no replyToken — use that as the signal
    // to record the admin-reply timestamp for the target user and stay silent.
    if (!event.replyToken) {
      await markAdminReplied(event.source?.userId);
      return [];
    }

    const set = langFromText(event.message.text);
    if (set) {
      await setLang(event, set);
      return buildLangSet(set);
    }

    const uid = event.source?.userId;
    const text = event.message.text;
    const routed = routeText(text, BASE_URL, lang);

    if (!routed.handoff) {
      // Suppress if admin explicitly silenced the bot (via /silence endpoint or
      // webhook detection) OR if the bot just replied and is in its post-reply
      // cooldown window (giving the admin a natural gap to take over).
      if (routed.intent && (isAdminReplyCooldown(uid) || isBotReplyCooldown(uid))) {
        const reason = isAdminReplyCooldown(uid) ? "admin-cooldown" : "bot-reply-cooldown";
        console.log(`[${reason}] suppressed "${routed.intent}" reply for ${uid}`);
        return [];
      }
      // A confirmed resolution clears the open handoff so the next problem gets
      // a fresh reassurance.
      if (routed.intent === "Resolution_Closure") await clearHandoff(event);
      // Stamp the bot-reply timestamp so the post-reply window starts now.
      if (routed.intent) await markBotReplied(uid);
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
    // Mirror the raw LINE payload to the team Google Sheet (fire-and-forget;
    // no-op unless SHEET_WEBHOOK_URL is set). Must not block the reply path.
    forwardToSheet(req.body);
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

// ── Startup ───────────────────────────────────────────────────────────────────
async function startServer() {
  // ── 1. Load content (Mongo or file) ────────────────────────────────────────
  if (config.content.backend === "mongo") {
    // Lazy-import so the mongo driver isn't loaded at all in file mode.
    const { connectMongo } = await import("./db/mongo.js");
    const { loadAllContent } = await import("./db/content-loader.js");

    await connectMongo(config.content.mongoUri);
    const loaded = await loadAllContent();

    // Hydrate each module with the fetched data.
    initContent({ content: loaded.content, translationsTh: loaded.translationsTh });
    initFaq(loaded.faqItems, loaded.faqTh);
    initIntents(loaded.intents);

    // Re-read manual.config.json from disk for validation (it's not in Mongo).
    const { readFileSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");
    const regPath = pathJoin(ROOT, "manual.config.json");
    const reg = JSON.parse(readFileSync(regPath, "utf8"));

    const { fails, warns } = validateData({
      reg,
      content: loaded.content,
      th: loaded.translationsTh,
      faqs: loaded.faqItems,
      areas: loaded.richmenuAreas,
    });
    for (const w of warns) console.warn("warn:", w);
    if (fails.length) {
      for (const f of fails) console.error("fail:", f);
      console.error(
        `\nRefusing to start: ${fails.length} content validation failure(s). ` +
          `Fix the data in MongoDB and restart.`
      );
      process.exit(1);
    }
  } else {
    // File mode — modules self-initialised from disk; run the disk validator.
    // Refuse to boot if committed artifacts are inconsistent. The same checks
    // run in the build gate, so this is a belt-and-braces guard for cases
    // where the server is started with stale data.
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

  // ── 2. Start HTTP server ───────────────────────────────────────────────────
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
}

startServer().catch((err) => {
  console.error("startup failed:", err);
  process.exit(1);
});

export { app, messagesFor };
