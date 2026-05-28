// Parse the FAQ CSV into faq.json and build a local embedding index
// (faq-index.json) with transformers.js. Run once, offline-cacheable:
//   node scripts/build_faq.mjs "/path/to/Lecturer_FAQ.csv"
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { pipeline } from "@xenova/transformers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV =
  process.argv[2] || join(homedir(), "Downloads", "Lecturer_FAQ.csv");
export const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

// FAQ Category -> manual section id. Derived from manual.config.json so the
// mapping is declared exactly once (each section lists its faqCategories).
const REG = JSON.parse(
  readFileSync(join(ROOT, "manual.config.json"), "utf8")
);
const CATEGORY_SECTION = Object.fromEntries(
  REG.sections.flatMap((s) => s.faqCategories.map((c) => [c, s.id]))
);

// Minimal RFC-4180 CSV parser (handles quoted fields, commas, "" escapes).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (field !== "" || row.length) { row.push(field); rows.push(row); }
      row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  const rows = parseCsv(readFileSync(CSV, "utf8"));
  rows.shift(); // header: No.,Category,Question,Answer
  const faqs = rows
    .filter((r) => r[2] && r[3])
    .map((r) => ({
      no: Number(r[0]),
      category: r[1].trim(),
      question: r[2].trim(),
      answer: r[3].trim(),
      sectionId: CATEGORY_SECTION[r[1].trim()] || null,
    }));

  const unmapped = [...new Set(
    faqs.filter((f) => !f.sectionId).map((f) => f.category)
  )];
  if (unmapped.length) console.warn("unmapped categories:", unmapped);

  writeFileSync(join(ROOT, "faq.json"), JSON.stringify(faqs, null, 2));
  console.log(`wrote faq.json (${faqs.length} entries)`);

  const extract = await pipeline("feature-extraction", MODEL);
  const items = [];
  for (const f of faqs) {
    const out = await extract(f.question, { pooling: "mean", normalize: true });
    items.push({ no: f.no, vector: Array.from(out.data) });
  }
  writeFileSync(
    join(ROOT, "faq-index.json"),
    JSON.stringify({ model: MODEL, dim: items[0].vector.length, items })
  );
  console.log(`wrote faq-index.json (${items.length} vectors, dim ${items[0].vector.length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
