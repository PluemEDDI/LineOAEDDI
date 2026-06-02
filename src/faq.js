// FAQ data access. Semantic search was removed to keep runtime memory low
// (the embedding model OOM'd Railway) — the bot is menu/button-driven only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAQS = JSON.parse(readFileSync(join(ROOT, "faq.json"), "utf8"));

export const faqByNo = new Map(FAQS.map((f) => [f.no, f]));

export const faqCategories = [...new Set(FAQS.map((f) => f.category))];
export const faqsByCategory = new Map(
  faqCategories.map((c) => [c, FAQS.filter((f) => f.category === c)])
);

