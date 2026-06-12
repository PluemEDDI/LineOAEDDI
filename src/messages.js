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
import {
  faqByNo,
  faqCategories,
  faqsByCategory,
  faqQuestion,
  faqAnswer,
  faqCategoryLabel,
} from "./faq.js";
import { config } from "./config.js";
import { isBusinessHours } from "./hours.js";
import { classifyIntent, intentTags } from "./intents.js";

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
  const list = faqCategories
    .map((c) => `• ${faqCategoryLabel(c, lang)}`)
    .join("\n");
  const items = faqCategories.map((c) =>
    postbackItem(faqCategoryLabel(c, lang), `faqcat=${encodeURIComponent(c)}`)
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
  const list = faqs.map((f) => `• ${faqQuestion(f, lang)}`).join("\n");
  const items = faqs.map((f) =>
    postbackItem(faqQuestion(f, lang), `faq=${f.no}`)
  );
  items.push(postbackItem(t(lang, "back"), "menu=faq"));
  items.push(postbackItem(t(lang, "mainMenu"), "action=menu"));
  return [
    {
      type: "text",
      text: `📂 ${faqCategoryLabel(category, lang)}\n\n${list}`,
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
    text: `💬 ${faqQuestion(faq, lang)}\n\n${faqAnswer(faq, lang)}\n\n${t(lang, "faqHint")}`,
    quickReply: { items },
  });
  return messages;
}

// Ambiguous query: show the top matches as "did you mean" options.
export function buildFaqSuggestions(results, lang) {
  const list = results.map((r) => `• ${faqQuestion(r.faq, lang)}`).join("\n");
  const items = results.map((r) =>
    postbackItem(faqQuestion(r.faq, lang), `faq=${r.no}`)
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

// ── Rich-menu button routes ───────────────────────────────────────────────────
// Videos live on YouTube — the bot never serves the mp4 itself. Tapping a tile
// opens the YouTube URL in LINE's in-app browser. Thumbnails are pulled from
// YouTube's CDN (img.youtube.com/vi/<id>/hqdefault.jpg, JPEG, ~30 KB, well
// under LINE's 1 MB preview cap). This keeps the Railway container memory
// footprint flat and removes the need to ship mp4s in the repo.
const ytThumb = (id) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
const ytUrl   = (id) => `https://youtu.be/${id}`;

const VIDEO_GALLERY = [
  { id: "gf4C9Nw2J_I", title: { th: "เข้าสู่ระบบ EDDI",    en: "How to Login EDDI" } },
  { id: "GnhZTb28hHs", title: { th: "ใช้งาน Live Class",   en: "How to Use Live Class" } },
  { id: "ZuEkreMZDMk", title: { th: "เรียนก่อนเข้าคลาส",   en: "Complete Your Pre-Class Learning" } },
  { id: "IuW6hVuFZDI", title: { th: "ส่งงาน",               en: "How to Submit an Assignment" } },
  { id: "kCNXo71nbgs", title: { th: "ใช้งาน Buddy AI",     en: "How to Use Buddy AI" } },
  { id: "br0SU_XuxSI", title: { th: "ติดตามความคืบหน้า",   en: "Track Your Learning Progress" } },
  { id: "76mXpjIJv9c", title: { th: "ตารางเรียน",           en: "Schedule Guide" } },
  { id: "lE8cM8UucG4", title: { th: "งานที่ต้องทำ",          en: "How to Use Tasks" } },
  { id: "LCpODlU4sIM", title: { th: "ฟอรัม",                en: "How to Use Forum" } },
];

function videoBubble({ id, title }, lang) {
  const label = lang === "th" ? "▶ ดูบน YouTube" : "▶ Watch on YouTube";
  const action = { type: "uri", label, uri: ytUrl(id) };
  return {
    type: "bubble",
    size: "mega",
    hero: {
      type: "image",
      url: ytThumb(id),
      size: "full",
      aspectRatio: "16:9",
      aspectMode: "cover",
      action,
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: title[lang] || title.en, weight: "bold", size: "md", wrap: true },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [{ type: "button", style: "primary", height: "sm", action }],
    },
  };
}

function buildVideoCarousel(lang) {
  return {
    type: "flex",
    altText: lang === "th" ? "วิดีโอแนะนำ" : "Intro videos",
    contents: {
      type: "carousel",
      // LINE allows up to 12 bubbles per carousel.
      contents: VIDEO_GALLERY.slice(0, 12).map((v) => videoBubble(v, lang)),
    },
  };
}

// Route a postback (other than action=setlang, handled by the server).
export function handlePostback(data, baseUrl, lang) {
  const params = new URLSearchParams(data);
  const action = params.get("action");
  if (action === "menu") return buildMenu(lang);
  if (action === "lang") return buildLangPicker(lang);

  // Rich-menu buttons. Only "manual" sends the video carousel — switching
  // menus back and forth should not spam the chat (back replies nothing).
  const menu = params.get("menu");
  if (menu === "manual") return [buildVideoCarousel(lang), ...buildMenu(lang)];
  if (menu === "faq") return buildFaqMenu(lang);
  if (menu === "contact") return [{ type: "text", text: t(lang, "contact") }];
  if (menu) return []; // e.g. menu=back — just switch the rich menu silently

  const faqcat = params.get("faqcat");
  if (faqcat) return buildFaqCategory(faqcat, lang);

  if (params.get("faq")) {
    return buildFaqAnswer(faqByNo.get(Number(params.get("faq"))), baseUrl, lang);
  }
  const id = params.get("section");
  return id ? buildSection(id, baseUrl, lang) : buildMenu(lang);
}

// Route typed text. Returns { messages, handoff, tags, businessHours }.
// Commands and section/FAQ numbers are handled directly; otherwise a keyword
// intent answer fires. When nothing matches, the message is handed off to a
// human and `handoff` is true (with best-guess `tags` for the admin).
export function routeText(input, baseUrl, lang) {
  const s = (input || "").trim();
  if (/^(menu|เมนู|start|เริ่ม)$/i.test(s)) return { messages: buildMenu(lang), handoff: false };
  if (/^(lang|language|ภาษา)$/i.test(s)) return { messages: buildLangPicker(lang), handoff: false };

  const sec = s.match(/\b1(?:\.\d+){1,2}\b/); // section id like 1.3 / 1.3.1
  if (sec && byId.has(sec[0])) return { messages: buildSection(sec[0], baseUrl, lang), handoff: false };

  if (/^\d{1,2}$/.test(s) && faqByNo.has(Number(s))) {
    return { messages: buildFaqAnswer(faqByNo.get(Number(s)), baseUrl, lang), handoff: false }; // typed "#29"
  }

  // Keyword intent match → pre-written answer (typo-tolerant; see intents.js).
  // Fires whenever a known operational intent is recognized, in or out of hours.
  // `intent` is surfaced so the caller can clear an open handoff on closure.
  const hit = classifyIntent(s);
  if (hit) return { messages: [{ type: "text", text: hit.answer(lang) }], handoff: false, intent: hit.name };

  // Nothing matched — a question only a human can answer. The reassurance reply
  // (deduped per user) and the team alert are the caller's job; this function
  // stays pure/stateless so it remains unit-testable. See server.js.
  return { messages: [], handoff: true, tags: intentTags(s), businessHours: isBusinessHours() };
}

// Back-compat thin wrapper: callers that only need the reply messages.
export async function handleText(input, baseUrl, lang) {
  return routeText(input, baseUrl, lang).messages;
}

// The reassurance shown when a message is handed off to a human: a "we're on
// it" note in hours, the closed note after hours. The server sends this at
// most once per handoff episode (see shouldReassure) so users aren't spammed.
export function buildHandoffMessage(lang, businessHours) {
  return [{ type: "text", text: t(lang, businessHours ? "handover" : "afterHours") }];
}

// True if a fresh reassurance should be sent: no prior handoff, or the previous
// one is older than the cooldown (treated as a new, separate support episode).
export function shouldReassure(lastHandoffAt, now, cooldownMs) {
  if (!lastHandoffAt) return true;
  return now - lastHandoffAt > cooldownMs;
}

export { normLang };
