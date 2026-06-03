// Single-source-of-truth loader. The section *tree* (id, titleEn, titleTh,
// parent, faqCategories, images) lives in manual.config.json; the English
// *body* comes from content.json (PDF-derived); the Thai *body* comes from
// translations.th.json. Everything else here is read-only derivation.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REG = JSON.parse(readFileSync(join(ROOT, "manual.config.json"), "utf8"));
const BODIES = JSON.parse(readFileSync(join(ROOT, "content.json"), "utf8"));
const TH = JSON.parse(readFileSync(join(ROOT, "translations.th.json"), "utf8"));

const bodyEnById = new Map(BODIES.map((b) => [b.id, b.body || ""]));
// `byId` exposes the registry record merged with `body` (English) for back-
// compat with existing callers that read `.images` and `.body`.
export const byId = new Map(
  REG.sections.map((s) => [s.id, { ...s, body: bodyEnById.get(s.id) || "" }])
);
export const allSections = REG.sections;

export const LANGS = ["th", "en"];
export const DEFAULT_LANG = config.ui.defaultLang;
export const normLang = (l) => (LANGS.includes(l) ? l : DEFAULT_LANG);

export const UI = {
  th: {
    menuPrompt: "เลือกหัวข้อ — กด ปุ่มด้านล่าง หรือ Manual QA",
    faqMenuPrompt: "เลือกหมวดคำถามที่เจอบ่อย:",
    subTopics: "— หัวข้อย่อย (แตะปุ่ม) —",
    menuHint: 'พิมพ์ "menu" เพื่อกลับเมนูหลัก',
    langLabel: "🌐 ภาษา Language",
    back: "⬅ ย้อนกลับ",
    mainMenu: "⬆ เมนูหลัก",
    welcome: "ยินดีต้อนรับ! เลือกหัวข้อที่ต้องการดูได้เลย",
    langPrompt: "เลือกภาษา / Choose a language:",
    langSet: "ตั้งค่าภาษาเป็นภาษาไทยแล้ว ✓",
    didYouMean: "คุณหมายถึงข้อใด? แตะเลือกหรือพิมพ์หมายเลข:",
    openSection: "📖 ดูหัวข้อเต็ม",
    notFound: "ไม่พบคำตอบที่ตรง ลองเลือกจากเมนู หรือพิมพ์คำถามใหม่",
    faqHint: 'พิมพ์คำถามได้เลย หรือพิมพ์ "menu"',
    contact:
      "ติดต่อเรา\nหากท่านมีข้อสงสัย ข้อเสนอแนะ หรือต้องการสอบถามข้อมูลเพิ่มเติม กรุณากรอกข้อมูลด้านล่าง ทีมงานจะติดต่อกลับโดยเร็วที่สุด\n\nEmail: nook.j@oventure-group.com",
  },
  en: {
    menuPrompt: "Choose a topic — Click Button / Manual QA",
    faqMenuPrompt: "Choose an FAQ category:",
    subTopics: "— Sub-topics (tap a button) —",
    menuHint: 'Type "menu" for the main menu',
    langLabel: "🌐 Language ภาษา",
    back: "⬅ Back",
    mainMenu: "⬆ Main menu",
    welcome: "Welcome! Pick a topic to get started.",
    langPrompt: "Choose a language / เลือกภาษา:",
    langSet: "Language set to English ✓",
    didYouMean: "Did you mean? Tap one or type its number:",
    openSection: "📖 Open full section",
    notFound: "No close match. Try the menu or rephrase your question.",
    faqHint: 'Type a question, or "menu"',
    contact:
      "Contact us\nIf you have any questions, suggestions, or need more information, please reach out below and our team will get back to you as soon as possible.\n\nEmail: nook.j@oventure-group.com",
  },
};
export const t = (lang, key) => UI[normLang(lang)][key];

// Title in the chosen language (from the registry — no PDF fallback needed).
export function getTitle(id, lang) {
  const s = byId.get(id);
  if (!s) return id;
  return normLang(lang) === "th" ? s.titleTh : s.titleEn;
}

// Body in the chosen language. English from content.json, Thai from
// translations.th.json (bodyTh). Both passed through formatBody for safety.
export function getBody(id, lang) {
  if (normLang(lang) === "th") return formatBody(TH[id]?.bodyTh || "");
  return formatBody(byId.get(id)?.body || "");
}

// Top-level section ids (parent == null), in registry order.
export const topLevel = REG.sections.filter((s) => !s.parent).map((s) => s.id);

// Direct children of a section, e.g. childrenOf("1.3") -> ["1.3.1", ...].
export function childrenOf(id) {
  return REG.sections.filter((s) => s.parent === id).map((s) => s.id);
}

export function parentOf(id) {
  return byId.get(id)?.parent ?? null;
}

// Turn raw table text into readable plain text (LINE has no markdown).
export function formatBody(raw) {
  if (!raw) return "";
  return raw
    .replace(/No\.\s*Feature\s*Description/g, "")
    .replace(/\s*●\s*/g, "\n• ")
    // Drop leading numbering on each line — "1.1. Home" / "1. Log in …" → bare text.
    .replace(/^\s*\d+(?:\.\d+)*[.)]?\s*/gm, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, config.ui.bodyMaxChars);
}
