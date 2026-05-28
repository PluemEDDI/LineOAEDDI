// Local, $0 semantic search over the FAQ. Embeds the user's query with the
// same multilingual model used to build faq-index.json and ranks FAQs by
// cosine similarity. No LLM: it only ever returns the pre-written answers.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAQS = JSON.parse(readFileSync(join(ROOT, "faq.json"), "utf8"));
const INDEX = JSON.parse(readFileSync(join(ROOT, "faq-index.json"), "utf8"));

export const faqByNo = new Map(FAQS.map((f) => [f.no, f]));

export const faqCategories = [...new Set(FAQS.map((f) => f.category))];
export const faqsByCategory = new Map(
  faqCategories.map((c) => [c, FAQS.filter((f) => f.category === c)])
);

// Decide what to do with ranked results:
//   "answer"  -> top is confident AND clearly ahead of the runner-up
//   "suggest" -> some decent matches but ambiguous: show "did you mean"
//   "none"    -> nothing relevant: fall back to the menu
// Thresholds (high / low / gap) come from src/config.js — tune via env.
export function classify(results) {
  const { high, low, gap } = config.faq;
  const top = results[0];
  if (!top || top.score < low) return "none";
  const second = results[1]?.score ?? 0;
  if (top.score >= high && top.score - second >= gap) return "answer";
  return "suggest";
}

// Lazy singleton embedder (model loads on first query, ~7s cold).
let _embed = null;
async function embedder() {
  if (!_embed) {
    const { pipeline } = await import("@xenova/transformers");
    const ext = await pipeline("feature-extraction", INDEX.model);
    _embed = async (s) => {
      const o = await ext(s, { pooling: "mean", normalize: true });
      return o.data; // already L2-normalized
    };
  }
  return _embed;
}

// Warm the model at startup so the first user doesn't eat the cold start.
export async function warmup() {
  const e = await embedder();
  await e("warmup");
}

const cosine = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // both vectors are normalized -> dot product == cosine similarity
};

// Return the top-k FAQ matches: [{ no, score, faq }], best first.
export async function search(query, k = 3) {
  const e = await embedder();
  const q = await e(query);
  return INDEX.items
    .map((it) => ({ no: it.no, score: cosine(q, it.vector), faq: faqByNo.get(it.no) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
