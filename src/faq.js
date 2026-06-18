// FAQ data access. Semantic search was removed to keep runtime memory low
// (the embedding model OOM'd Railway) — the bot is menu/button-driven only.
//
// Two init modes:
//   CONTENT_BACKEND=file  (default) — readFileSync at module load (unchanged).
//   CONTENT_BACKEND=mongo — init(faqs, th) called from server.js after
//                           loadAllContent() resolves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Mutable state — populated either at module load (file mode) or by init().
// ---------------------------------------------------------------------------
let _faqByNo = new Map();
let _faqCategories = [];
let _faqsByCategory = new Map();
let _TH = { items: {}, categories: {} };

function _build(faqs, th) {
  _TH = th;
  _faqByNo = new Map(faqs.map((f) => [f.no, f]));
  _faqCategories = [...new Set(faqs.map((f) => f.category))];
  _faqsByCategory = new Map(
    _faqCategories.map((c) => [c, faqs.filter((f) => f.category === c)])
  );
}

// ---------------------------------------------------------------------------
// File-mode: self-init synchronously at module load.
// ---------------------------------------------------------------------------
if (config.content.backend === "file") {
  const FAQS = JSON.parse(readFileSync(join(ROOT, "faq.json"), "utf8"));
  // Thai translations live beside the English source so a faq.json rebuild
  // from the CSV never wipes them (same pattern as translations.th.json).
  const TH = JSON.parse(readFileSync(join(ROOT, "faq.th.json"), "utf8"));
  _build(FAQS, TH);
}

// ---------------------------------------------------------------------------
// Mongo-mode: server.js calls init() after loadAllContent() resolves.
// ---------------------------------------------------------------------------
/**
 * Populate in-memory FAQ data (called by server.js when CONTENT_BACKEND=mongo).
 * @param {Array}  faqItems  — equivalent to faq.json
 * @param {Object} faqTh     — equivalent to faq.th.json
 */
export function init(faqItems, faqTh) {
  _build(faqItems, faqTh);
}

// ---------------------------------------------------------------------------
// Public API (unchanged signatures).
// ---------------------------------------------------------------------------
export const faqByNo = new Proxy(
  {},
  {
    get(_, prop) {
      const val = _faqByNo[prop];
      if (typeof val === "function") return val.bind(_faqByNo);
      return _faqByNo[prop] !== undefined ? _faqByNo[prop] : _faqByNo.get(prop);
    },
  }
);

export const faqCategories = new Proxy([], {
  get(_, prop) {
    return _faqCategories[prop];
  },
});

export const faqsByCategory = new Proxy(
  {},
  {
    get(_, prop) {
      const val = _faqsByCategory[prop];
      if (typeof val === "function") return val.bind(_faqsByCategory);
      return _faqsByCategory[prop] !== undefined
        ? _faqsByCategory[prop]
        : _faqsByCategory.get(prop);
    },
  }
);

// Language-aware accessors — fall back to English when no Thai translation.
export const faqQuestion = (f, lang) =>
  (lang === "th" && _TH.items[f.no]?.q) || f.question;
export const faqAnswer = (f, lang) =>
  (lang === "th" && _TH.items[f.no]?.a) || f.answer;
export const faqCategoryLabel = (c, lang) =>
  (lang === "th" && _TH.categories[c]) || c;
