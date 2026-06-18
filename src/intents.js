// Keyword-driven intent classifier for free-text messages. Lightweight on
// purpose: normalized substring + character-bigram fuzzy match, no embedding
// model (semantic search was removed because it OOM'd Railway — see faq.js).
// Data lives in intents.json (hand-edited); the fuzzy threshold is a config knob.
//
// Two init modes:
//   CONTENT_BACKEND=file  (default) — readFileSync at module load (unchanged).
//   CONTENT_BACKEND=mongo — init(data) called from server.js after
//                           loadAllContent() resolves.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUZZY = config.intents.fuzzy;

// ---------------------------------------------------------------------------
// Mutable state — populated either at module load (file mode) or by init().
// ---------------------------------------------------------------------------
let PARTICLES = [];
let INTENTS = [];

function _build(data) {
  PARTICLES = data.settings.particles;
  INTENTS = data.intents;
}

// ---------------------------------------------------------------------------
// File-mode: self-init synchronously at module load.
// ---------------------------------------------------------------------------
if (config.content.backend === "file") {
  const DATA = JSON.parse(readFileSync(join(ROOT, "intents.json"), "utf8"));
  _build(DATA);
}

// ---------------------------------------------------------------------------
// Mongo-mode: server.js calls init() after loadAllContent() resolves.
// ---------------------------------------------------------------------------
/**
 * Populate in-memory intents data (called by server.js when CONTENT_BACKEND=mongo).
 * @param {{ settings: Object, intents: Array }} data — equivalent to intents.json
 */
export function init(data) {
  _build(data);
}

// ---------------------------------------------------------------------------
// Pure classification functions (unchanged logic).
// ---------------------------------------------------------------------------

// Normalize a message: lowercase, drop trailing polite particles, collapse
// 3+ repeated chars (เลยยย → เลยย, ๆๆๆ → ๆๆ). Keywords get the same treatment
// minus particle stripping (keywords carry no particles).
function normalize(s, { stripParticles = false } = {}) {
  let out = (s || "").toLowerCase().trim();
  out = out.replace(/(.)(\1){2,}/g, "$1$1"); // 3+ repeats → 2
  if (stripParticles) {
    // Strip polite particles only from the END of the message (repeatedly), so
    // "เข้าไม่ได้ครับ"/"เข้าไม่ได้ค่า" normalize to "เข้าไม่ได้" — WITHOUT eating
    // particles that live inside content words (e.g. "ค้า" ⊂ "ค้าง"/stuck,
    // "คะ" ⊂ "คะแนน"/score, "ค่า" ⊂ "ค่าเทอม"). Suffix-only is the safe rule.
    let changed = true;
    while (changed) {
      changed = false;
      out = out.replace(/\s+$/, "");
      for (const p of PARTICLES) {
        if (p && out.endsWith(p)) {
          out = out.slice(0, -p.length);
          changed = true;
          break;
        }
      }
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

// Sørensen–Dice coefficient over character bigrams — typo-tolerant and cheap.
function bigrams(s) {
  const g = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const b = s.slice(i, i + 2);
    g.set(b, (g.get(b) || 0) + 1);
  }
  return g;
}
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [bg, ca] of ga) overlap += Math.min(ca, gb.get(bg) || 0);
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

// Best score of a keyword against a message: 1.0 if it appears literally,
// else the max Dice over windows of the message near the keyword's length
// (so a typo'd keyword inside a longer sentence still matches).
function keywordScore(kw, msg) {
  if (msg.includes(kw)) return 1;
  if (kw.length < 2) return 0;
  let best = 0;
  const lens = [kw.length - 1, kw.length, kw.length + 1].filter((n) => n >= 2);
  for (const L of lens) {
    for (let i = 0; i + L <= msg.length; i++) {
      const d = dice(kw, msg.slice(i, i + L));
      if (d > best) best = d;
    }
  }
  return best;
}

// Orphaned credentials sent with little/no intent text. Detected by pattern
// (not keyword): BU e-mail (incl. the common dropped-"@" typo) or a 10-digit
// student ID. Run on the RAW input so e-mail addresses stay intact.
const PII_EMAIL = /[a-z0-9._%+-]+@(?:bumail\.net|bu\.ac\.th|bumail\.ac\.th)/i;
const PII_ID = /(?<!\d)\d{10}(?!\d)/;
function hasPII(raw) {
  return PII_EMAIL.test(raw) || PII_ID.test(raw);
}

// Score every intent against a message: the best keyword score per intent,
// plus a pattern bump for Orphaned_PII. Closure intents are dropped when a
// negator is present (e.g. the false closure "เข้าได้แล้ว(ไม่ได้)").
function scoreAll(input) {
  const msg = normalize(input, { stripParticles: true });
  if (!msg) return [];

  const scored = [];
  for (const intent of INTENTS) {
    if (intent.closure && intent.negators?.some((n) => msg.includes(normalize(n)))) {
      continue; // not a real closure
    }
    let best = 0;
    for (const kw of intent.keywords) {
      const score = keywordScore(normalize(kw), msg);
      if (score > best) best = score;
    }
    scored.push({ intent, score: best });
  }

  // Pattern-detected PII counts as a full match even when no keyword fired.
  if (hasPII(input)) {
    const e = scored.find((m) => m.intent.name === "Orphaned_PII");
    if (e) e.score = Math.max(e.score, 1);
  }
  return scored;
}

// Classify a free-text message. Returns { name, score, answer(lang) } for the
// best matching intent, or null if nothing clears the fuzzy threshold.
// Tie-break by priority (lower wins) so closure/PII beat problem intents.
export function classifyIntent(input) {
  const matches = scoreAll(input).filter((m) => m.score >= FUZZY);
  if (!matches.length) return null;

  matches.sort((a, b) =>
    a.intent.priority !== b.intent.priority
      ? a.intent.priority - b.intent.priority
      : b.score - a.score
  );
  const { intent, score } = matches[0];
  return {
    name: intent.name,
    score,
    answer: (lang) =>
      intent.answer[lang === "en" ? "en" : "th"] || intent.answer.th,
  };
}

// Best-guess intent labels for a message, including weak matches below the
// answer threshold. Used to tag a human handoff with likely topics so the
// admin sees context even when nothing was confident enough to auto-answer.
export function intentTags(input, min = config.intents.tagMin) {
  return scoreAll(input)
    .filter((m) => m.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m) => m.intent.name);
}
