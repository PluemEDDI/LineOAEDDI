// Content-pipeline validator.
//
// Two layers:
//   validateData(...)  pure function on already-loaded data (testable)
//   validate()         reads everything from disk and calls validateData
//
// Rule severities:
//   fail  -> build aborts; runtime refuses to boot
//   warn  -> build proceeds; logged
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function validateData({
  reg, content, th, faqs = null, areas = null,
  imageFiles = [], previewSizes = {},
}) {
  const fails = [];
  const warns = [];

  const sections = reg.sections;
  const sectionIds = new Set(sections.map((s) => s.id));
  const contentById = new Map(content.map((c) => [c.id, c]));
  const imageSet = new Set(imageFiles);

  for (const s of sections) {
    if (!s.titleEn) fails.push(`registry: ${s.id} missing titleEn`);
    if (!s.titleTh) fails.push(`registry: ${s.id} missing titleTh`);
    if (!th[s.id]?.bodyTh) fails.push(`translation: ${s.id} missing bodyTh`);
    if (!contentById.has(s.id)) {
      fails.push(`content: ${s.id} missing from content.json`);
    }
    for (const fn of s.images || []) {
      if (!imageSet.has(fn)) {
        fails.push(`image: ${s.id} declares "${fn}" but img/${fn} is missing`);
      }
    }
  }

  for (const k of Object.keys(th)) {
    if (k === "_note") continue;
    if (!sectionIds.has(k)) {
      fails.push(`translation: orphan key "${k}" (not in registry)`);
    }
  }

  if (faqs) {
    const cats = new Set();
    for (const s of sections) for (const c of s.faqCategories || []) cats.add(c);
    for (const f of faqs) {
      if (!cats.has(f.category)) {
        fails.push(`faq: row #${f.no} category "${f.category}" not in any section`);
      }
    }
  }

  if (areas) {
    for (const a of areas) {
      const m = (a.action?.data || "").match(/^section=(\S+)$/);
      if (m && !sectionIds.has(m[1])) {
        fails.push(`richmenu: area references "${m[1]}" not in registry`);
      }
    }
  }

  for (const s of sections) {
    const c = contentById.get(s.id);
    if (c?.body && !(s.images || []).length) {
      warns.push(`${s.id} has body but no image (verify intended)`);
    }
  }
  for (const [fn, size] of Object.entries(previewSizes)) {
    if (size > 1_000_000) {
      warns.push(`preview/${fn} is ${(size / 1024).toFixed(0)}KB (>1MB cap)`);
    }
  }

  return { fails, warns };
}

const j = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const ex = (p) => existsSync(join(ROOT, p));

export function validate() {
  const reg = j("manual.config.json");
  const content = j("content.json");
  const th = j("translations.th.json");
  const faqs = ex("faq.json") ? j("faq.json") : null;
  const areas = ex("richmenu-areas.json") ? j("richmenu-areas.json") : null;
  const imageFiles = ex("img") ? readdirSync(join(ROOT, "img")) : [];
  const previewSizes = {};
  if (ex("preview")) {
    for (const fn of readdirSync(join(ROOT, "preview"))) {
      previewSizes[fn] = statSync(join(ROOT, "preview", fn)).size;
    }
  }
  return validateData({ reg, content, th, faqs, areas, imageFiles, previewSizes });
}
