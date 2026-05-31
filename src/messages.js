// Builds LINE message payloads for the menu-navigation flow (TH/EN).
import {
  byId,
  childrenOf,
  parentOf,
  topLevel,
  getTitle,
  getBody,
  normLang,
  t,
} from "./content.js";
import { search, classify, faqByNo, faqCategories, faqsByCategory } from "./faq.js";
import { config } from "./config.js";

const MAX_IMAGES = config.reply.maxImages;
const QR_LABEL_MAX = config.reply.qrLabelMax;

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function postbackItem(label, data) {
  return {
    type: "action",
    action: { type: "postback", label: trunc(label, QR_LABEL_MAX), data },
  };
}

// A typeable list of options, e.g. "1.3  สอนสด". Quick Reply / Rich Menu are
// mobile-only, so this text list is how PC users navigate.
function optionList(ids, lang) {
  return ids.map((id) => `• ${getTitle(id, lang)}`).join("\n");
}

function quickReply(id, lang) {
  const items = childrenOf(id).map((cid) =>
    postbackItem(getTitle(cid, lang), `section=${cid}`)
  );
  const parent = parentOf(id);
  if (parent) items.push(postbackItem(t(lang, "back"), `section=${parent}`));
  items.push(postbackItem(t(lang, "mainMenu"), "action=menu"));
  items.push(postbackItem(t(lang, "langLabel"), "action=lang"));
  return { items: items.slice(0, 13) };
}

function imageMessage(file, baseUrl) {
  const name = encodeURIComponent(file);
  return {
    type: "image",
    originalContentUrl: `${baseUrl}/img/${name}`,
    previewImageUrl: `${baseUrl}/preview/${name}`, // downscaled, <=1MB
  };
}

// Top-level menu (also mirrored by the persistent Rich Menu).
export function buildMenu(lang) {
  const items = topLevel.map((id) =>
    postbackItem(getTitle(id, lang), `section=${id}`)
  );
  items.push(postbackItem(t(lang, "langLabel"), "action=lang"));
  return [
    {
      type: "text",
      text: `${t(lang, "menuPrompt")}\n\n${optionList(topLevel, lang)}`,
      quickReply: { items: items.slice(0, 13) },
    },
  ];
}

// Full reply for a section: screenshots + text + drill-down menu.
export function buildSection(id, baseUrl, lang) {
  const section = byId.get(id);
  if (!section) return buildMenu(lang);

  const messages = section.images
    .slice(0, MAX_IMAGES)
    .map((f) => imageMessage(f, baseUrl));

  const body = getBody(id, lang);
  const children = childrenOf(id);
  let text = body ? `📖 ${getTitle(id, lang)}\n\n${body}` : `📖 ${getTitle(id, lang)}`;
  if (children.length) {
    text += `\n\n${t(lang, "subTopics")}\n${optionList(children, lang)}`;
  }
  text += `\n\n${t(lang, "menuHint")}`;

  messages.push({ type: "text", text, quickReply: quickReply(id, lang) });
  return messages;
}

// FAQ top-level menu: list categories as selectable buttons.
export function buildFaqMenu(lang) {
  const list = faqCategories.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const items = faqCategories.map((c) =>
    postbackItem(c, `faqcat=${encodeURIComponent(c)}`)
  );
  items.push(postbackItem(t(lang, "mainMenu"), "action=menu"));
  items.push(postbackItem(t(lang, "langLabel"), "action=lang"));
  return [
    {
      type: "text",
      text: `${t(lang, "faqMenuPrompt")}\n\n${list}`,
      quickReply: { items: items.slice(0, 13) },
    },
  ];
}

// Drill-down: FAQs within a chosen category.
export function buildFaqCategory(category, lang) {
  const faqs = faqsByCategory.get(category);
  if (!faqs) return buildFaqMenu(lang);
  const list = faqs.map((f) => `#${f.no}  ${f.question}`).join("\n");
  const items = faqs.map((f) =>
    postbackItem(`#${f.no} ${f.question}`, `faq=${f.no}`)
  );
  items.push(postbackItem(t(lang, "back"), "menu=faq"));
  items.push(postbackItem(t(lang, "mainMenu"), "action=menu"));
  return [
    {
      type: "text",
      text: `📂 ${category}\n\n${list}`,
      quickReply: { items: items.slice(0, 13) },
    },
  ];
}

// Language chooser.
export function buildLangPicker(lang) {
  return [
    {
      type: "text",
      text: t(lang, "langPrompt"),
      quickReply: {
        items: [
          postbackItem("ไทย Thai", "action=setlang&lang=th"),
          postbackItem("English อังกฤษ", "action=setlang&lang=en"),
        ],
      },
    },
  ];
}

// Confirmation after switching language, followed by the menu.
export function buildLangSet(lang) {
  return [{ type: "text", text: t(lang, "langSet") }, ...buildMenu(lang)];
}

// Map a "set language" word typed by the user to a lang code, or null.
export function langFromText(input) {
  const s = (input || "").trim().toLowerCase();
  if (/^(th|ไทย|ภาษาไทย|thai)$/.test(s)) return "th";
  if (/^(en|eng|english|อังกฤษ|ภาษาอังกฤษ)$/.test(s)) return "en";
  return null;
}

// A FAQ answer: optional category screenshot + question + pre-written answer.
export function buildFaqAnswer(faq, baseUrl, lang) {
  if (!faq) return buildMenu(lang);
  const messages = [];
  const img = faq.sectionId && byId.get(faq.sectionId)?.images?.[0];
  if (img) messages.push(imageMessage(img, baseUrl));

  const items = [];
  if (faq.sectionId) {
    items.push(postbackItem(t(lang, "openSection"), `section=${faq.sectionId}`));
  }
  items.push(postbackItem(t(lang, "mainMenu"), "action=menu"));
  items.push(postbackItem(t(lang, "langLabel"), "action=lang"));

  messages.push({
    type: "text",
    text: `💬 ${faq.question}\n\n${faq.answer}\n\n${t(lang, "faqHint")}`,
    quickReply: { items },
  });
  return messages;
}

// Ambiguous query: show the top matches as "did you mean" options.
export function buildFaqSuggestions(results, lang) {
  const list = results.map((r) => `#${r.no}  ${r.faq.question}`).join("\n");
  const items = results.map((r) =>
    postbackItem(`#${r.no} ${r.faq.question}`, `faq=${r.no}`)
  );
  items.push(postbackItem(t(lang, "mainMenu"), "action=menu"));
  return [
    {
      type: "text",
      text: `${t(lang, "didYouMean")}\n${list}`,
      quickReply: { items: items.slice(0, 13) },
    },
  ];
}

// ── Video Message ─────────────────────────────────────────────────────────────
// Builds a LINE video message object.
// videoUrl  : HTTPS URL of the .mp4 file
// previewUrl: HTTPS URL of the thumbnail image shown before playback
// trackingId: optional, used by LINE to track views (string, max 100 chars)
export function buildVideoMessage(videoUrl, previewUrl, trackingId) {
  const msg = {
    type: "video",
    originalContentUrl: videoUrl,   // must be HTTPS, ≤200 MB, mp4
    previewImageUrl: previewUrl,    // must be HTTPS, ≤1 MB, JPEG/PNG
  };
  if (trackingId) msg.trackingId = trackingId;  // enables delivery analytics
  return msg;
}

// ── Rich-menu button routes ───────────────────────────────────────────────────
// Videos are served from the project's video/ folder via BASE_URL.
// File: video/Log in.mp4  →  https://<ngrok>/video/Log%20in.mp4
const _base = config.server.baseUrl;
// All clips under video/ are presented as a swipeable Flex carousel of
// thumbnails. Tapping a tile fires a postback that replies with the
// corresponding plain `video` message (Flex video hero isn't enabled on this
// OA, and trackingId chars are tightly restricted, so both are avoided).
const VIDEO_GALLERY = {
  login: {
    video:   `${_base}/video/Log%20in/Log%20in.mp4`,
    preview: `${_base}/video/Log%20in/1.png`,
    title:   { th: "เข้าสู่ระบบ", en: "Log in" },
  },
  ai: {
    video:   `${_base}/video/Ai/AI.mp4`,
    preview: `${_base}/video/Ai/ปก%20Manual.png`,
    title:   { th: "AI Assistant", en: "AI Assistant" },
  },
  liveclass: {
    video:   `${_base}/video/LiveClass/LiveClass.mp4`,
    preview: `${_base}/video/LiveClass/3.png`,
    title:   { th: "Live Class", en: "Live Class" },
  },
  preclass: {
    video:   `${_base}/video/PreClass/PreClass.mp4`,
    preview: `${_base}/video/PreClass/2.png`,
    title:   { th: "Pre Class", en: "Pre-Class" },
  },
  webforum: {
    video: `${_base}/video/Forum/Forum.mp4`,
    preview: `${_base}/video/Forum/5.png`,
    title: { th: "Forum", en: "Forum" },
  },
  assingment: {
    video: `${_base}/video/Assignment/Assignment.mp4`,
    preview: `${_base}/video/Assignment/8.png`,
    title: { th: "Assignment", en: "Assignment" },
  },
  task: {
    video: `${_base}/video/Task/Task.mp4`,
    preview: `${_base}/video/Task/7.png`,
    title: { th: "Task", en: "Task" },
  },
  schedual: {
    video: `${_base}/video/Schedual/Schedual.mp4`,
    preview: `${_base}/video/Schedual/6.png`,
    title: { th: "Schedule", en: "Schedule" },
  },
  progress: {
    video: `${_base}/video/Progress%20Tracking/Progress.mp4`,
    preview: `${_base}/video/Progress%20Tracking/ปก%20Manual.png`,
    title: { th: "Progress", en: "Progress" },
  },
  
};

function videoBubble(key, cfg, lang) {
  const playLabel = lang === "th" ? "▶ เล่นวิดีโอ" : "▶ Play video";
  const action = { type: "postback", label: playLabel, data: `video=${key}` };
  return {
    type: "bubble",
    size: "mega",
    hero: {
      type: "image",
      url: cfg.preview,
      size: "full",
      aspectRatio: "16:9",
      aspectMode: "cover",
      action,
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: cfg.title[lang] || cfg.title.en, weight: "bold", size: "md", wrap: true },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "button", style: "primary", height: "sm", action },
      ],
    },
  };
}

function buildVideoCarousel(lang) {
  return {
    type: "flex",
    altText: lang === "th" ? "วิดีโอแนะนำ" : "Intro videos",
    contents: {
      type: "carousel",
      contents: Object.entries(VIDEO_GALLERY).map(([k, v]) => videoBubble(k, v, lang)),
    },
  };
}

function buildMenuVideo(key, lang) {
  const follow = key === "faq" ? buildFaqMenu(lang) : buildMenu(lang);
  return [buildVideoCarousel(lang), ...follow];
}

function buildVideoPlay(key, lang) {
  const cfg = VIDEO_GALLERY[key];
  if (!cfg) return buildMenu(lang);
  return [buildVideoMessage(cfg.video, cfg.preview)];
}

// Route a postback (other than action=setlang, handled by the server).
export function handlePostback(data, baseUrl, lang) {
  const params = new URLSearchParams(data);
  const action = params.get("action");
  if (action === "menu") return buildMenu(lang);
  if (action === "lang") return buildLangPicker(lang);

  // Rich-menu bottom buttons → swipeable video carousel + main menu
  const menu = params.get("menu");
  if (menu) return buildMenuVideo(menu, lang);

  // Tile tapped inside the carousel → play that video
  const video = params.get("video");
  if (video) return buildVideoPlay(video, lang);

  const faqcat = params.get("faqcat");
  if (faqcat) return buildFaqCategory(faqcat, lang);

  if (params.get("faq")) {
    return buildFaqAnswer(faqByNo.get(Number(params.get("faq"))), baseUrl, lang);
  }
  const id = params.get("section");
  return id ? buildSection(id, baseUrl, lang) : buildMenu(lang);
}

// Route typed text. Commands and section/FAQ numbers are handled directly;
// anything else is treated as a question and runs semantic FAQ search.
export async function handleText(input, baseUrl, lang) {
  const s = (input || "").trim();
  if (/^(menu|เมนู|start|เริ่ม)$/i.test(s)) return buildMenu(lang);
  if (/^(lang|language|ภาษา)$/i.test(s)) return buildLangPicker(lang);

  const sec = s.match(/\b1(?:\.\d+){1,2}\b/); // section id like 1.3 / 1.3.1
  if (sec && byId.has(sec[0])) return buildSection(sec[0], baseUrl, lang);

  if (/^\d{1,2}$/.test(s) && faqByNo.has(Number(s))) {
    return buildFaqAnswer(faqByNo.get(Number(s)), baseUrl, lang); // typed "#29"
  }

  const results = await search(s, 3);
  const verdict = classify(results);
  if (verdict === "answer") return buildFaqAnswer(results[0].faq, baseUrl, lang);
  if (verdict === "suggest") return buildFaqSuggestions(results, lang);
  return [{ type: "text", text: t(lang, "notFound") }, ...buildMenu(lang)];
}

export { normLang };
