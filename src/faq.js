// FAQ data access. Semantic search was removed to keep runtime memory low
// (the embedding model OOM'd Railway) — the bot is menu/button-driven only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAQS = JSON.parse(readFileSync(join(ROOT, "faq.json"), "utf8"));
// Thai translations live beside the English source so a faq.json rebuild
// from the CSV never wipes them (same pattern as translations.th.json).
const TH = JSON.parse(readFileSync(join(ROOT, "faq.th.json"), "utf8"));

export const faqByNo = new Map(FAQS.map((f) => [f.no, f]));

export const faqCategories = [...new Set(FAQS.map((f) => f.category))];
export const faqsByCategory = new Map(
  faqCategories.map((c) => [c, FAQS.filter((f) => f.category === c)])
);

// Language-aware accessors — fall back to English when no Thai translation.
export const faqQuestion = (f, lang) =>
  (lang === "th" && TH.items[f.no]?.q) || f.question;
export const faqAnswer = (f, lang) =>
  (lang === "th" && TH.items[f.no]?.a) || f.answer;
export const faqCategoryLabel = (c, lang) =>
  (lang === "th" && TH.categories[c]) || c;

