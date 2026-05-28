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
  handleText,
  langFromText,
} from "./messages.js";
import { normLang, t } from "./content.js";
import { warmup } from "./faq.js";
import { config } from "./config.js";
import { createUserStore } from "./store/user-store.js";
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

// Serve the manual screenshots and videos referenced by messages.
app.use("/img",     express.static(join(ROOT, "img")));
app.use("/preview", express.static(join(ROOT, "preview")));
app.use("/video",   express.static(join(ROOT, "video")));
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
    return handleText(event.message.text, BASE_URL, lang);
  }
  return buildMenu(lang);
}

// The LINE middleware verifies the X-Line-Signature header using the raw body,
// so it must run before any JSON body parser on this route.
app.post("/webhook", middleware({ channelSecret }), async (req, res) => {
  try {
    await Promise.all(
      (req.body.events || []).map(async (event) => {
        const messages = await messagesFor(event);
        if (!event.replyToken) return;
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
  // Load the embedding model up front so the first user's question is fast.
  warmup()
    .then(() => console.log("FAQ embedding model ready"))
    .catch((e) => console.error("FAQ model warmup failed:", e));
  if (!BASE_URL.startsWith("https://")) {
    console.warn(
      `⚠  BASE_URL is not HTTPS. LINE rejects image URLs that aren't HTTPS — ` +
        `set BASE_URL to your public https URL (e.g. the ngrok URL).`
    );
  }
});

export { app, messagesFor };
