// Offline checks for the message builders + routing (no model, no network).
// The live semantic-search check lives in test/search-test.mjs.
// Run: npm test
import assert from "node:assert/strict";
import {
  buildMenu,
  buildSection,
  buildLangPicker,
  buildFaqAnswer,
  buildFaqSuggestions,
  handlePostback,
  handleText,
} from "../src/messages.js";
import { classify, faqByNo } from "../src/faq.js";
import { config } from "../src/config.js";
import { MemoryUserStore } from "../src/store/memory-user-store.js";
import { FileUserStore } from "../src/store/file-user-store.js";
import { validate, validateData } from "../src/validate.js";

const BASE = "https://example.test";
let passed = 0;
const ok = async (name, fn) => {
  await fn();
  console.log("  ✓", name);
  passed++;
};
const textOf = (msgs) => msgs.find((m) => m.type === "text").text;

await ok("main menu offers 7 sections + a language button", () => {
  const items = buildMenu("en")[0].quickReply.items;
  assert.equal(items.length, 8);
  assert.ok(items.some((i) => i.action.data === "action=lang"));
});

await ok("section 1.3.1 returns its screenshot + text", () => {
  const msgs = buildSection("1.3.1", BASE, "en");
  const img = msgs.find((m) => m.type === "image");
  assert.match(img.originalContentUrl, /1\.3\.1_16_1\.png$/);
  assert.match(img.previewImageUrl, /\/preview\/1\.3\.1_16_1\.png$/);
  assert.match(textOf(msgs), /Pause Screen/);
});

await ok("Thai vs English render the right title", () => {
  assert.match(textOf(buildSection("1.3.1", BASE, "th")), /หน้าจอพัก/);
  assert.match(textOf(buildSection("1.3.1", BASE, "en")), /Pause Screen/);
});

await ok("parent section drills down; child has Back + Menu", () => {
  const p = buildSection("1.3", BASE, "en").at(-1).quickReply.items.map((i) => i.action.data);
  assert.ok(p.includes("section=1.3.1") && p.includes("section=1.3.8"));
  const c = buildSection("1.3.1", BASE, "en").at(-1).quickReply.items.map((i) => i.action.data);
  assert.ok(c.includes("section=1.3") && c.includes("action=menu"));
});

await ok("language picker offers th + en", () => {
  const data = buildLangPicker("en")[0].quickReply.items.map((i) => i.action.data);
  assert.ok(data.includes("action=setlang&lang=th"));
  assert.ok(data.includes("action=setlang&lang=en"));
});

await ok("MemoryUserStore round-trips per-user keys", async () => {
  const s = new MemoryUserStore();
  assert.equal(s.get("u1", "lang"), undefined);
  await s.set("u1", "lang", "th");
  await s.set("u2", "lang", "en");
  assert.equal(s.get("u1", "lang"), "th");
  assert.equal(s.get("u2", "lang"), "en");
  assert.equal(s.get("u1", "missing"), undefined);
});

await ok("FileUserStore persists across instances", async () => {
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { rmSync } = await import("node:fs");
  const path = join(tmpdir(), `userstore-test-${Date.now()}.json`);
  try {
    const a = new FileUserStore({ path });
    await a.set("u1", "lang", "th");
    await a.set("u1", "bookmark", "1.3.1");
    const b = new FileUserStore({ path }); // reload from disk
    assert.equal(b.get("u1", "lang"), "th");
    assert.equal(b.get("u1", "bookmark"), "1.3.1");
  } finally {
    try { rmSync(path); } catch {}
  }
});

await ok("validate() passes on current committed artifacts", () => {
  const { fails } = validate();
  assert.deepEqual(fails, [], `unexpected fails: ${fails.join("; ")}`);
});

await ok("validateData catches each fail-class rule", () => {
  const baseReg = { sections: [
    { id: "1.1", titleEn: "Home", titleTh: "หน้าหลัก", parent: null,
      faqCategories: ["Home"], images: ["1.1_2_1.png"] },
  ] };
  const baseContent = [{ id: "1.1", titleEn: "Home", body: "x", images: [] }];
  const baseTh = { "1.1": { bodyTh: "x" } };
  const ok = { reg: baseReg, content: baseContent, th: baseTh,
    imageFiles: ["1.1_2_1.png"] };
  // Happy path
  assert.deepEqual(validateData(ok).fails, []);
  // Missing titleTh
  assert.match(
    validateData({ ...ok, reg: { sections: [{ ...baseReg.sections[0], titleTh: "" }] } }).fails.join(),
    /missing titleTh/
  );
  // Missing Thai body
  assert.match(validateData({ ...ok, th: {} }).fails.join(), /missing bodyTh/);
  // Orphan translation key
  assert.match(
    validateData({ ...ok, th: { ...baseTh, "9.9": { bodyTh: "x" } } }).fails.join(),
    /orphan key "9\.9"/
  );
  // Declared image missing on disk
  assert.match(validateData({ ...ok, imageFiles: [] }).fails.join(), /missing/);
  // FAQ category not in any section
  assert.match(
    validateData({ ...ok, faqs: [{ no: 1, category: "Nope" }] }).fails.join(),
    /Nope/
  );
  // RichMenu area references unknown section
  assert.match(
    validateData({ ...ok, areas: [{ action: { data: "section=9.9" } }] }).fails.join(),
    /9\.9/
  );
});

await ok("config exposes typed defaults", () => {
  assert.equal(typeof config.faq.high, "number");
  assert.ok(config.faq.high >= config.faq.low, "high >= low");
  assert.ok(config.reply.maxImages <= 5);
  assert.ok(["th", "en"].includes(config.ui.defaultLang));
});

await ok("config rejects malformed env (subprocess check)", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "import('./src/config.js')"],
    { env: { ...process.env, FAQ_HIGH: "not-a-number" }, encoding: "utf8" }
  );
  assert.notEqual(r.status, 0, "expected non-zero exit on bad FAQ_HIGH");
  assert.match(r.stderr, /FAQ_HIGH/);
});

await ok("classify: confident + clear winner -> answer", () => {
  assert.equal(classify([{ score: 0.77 }, { score: 0.5 }]), "answer");
});
await ok("classify: ambiguous near-tie -> suggest", () => {
  assert.equal(classify([{ score: 0.48 }, { score: 0.43 }]), "suggest");
});
await ok("classify: nothing relevant -> none", () => {
  assert.equal(classify([{ score: 0.29 }, { score: 0.2 }]), "none");
});

await ok("FAQ answer includes the question, answer, and section button", () => {
  const faq = faqByNo.get(49); // download report (After Class -> 1.4.1)
  const msgs = buildFaqAnswer(faq, BASE, "en");
  assert.match(textOf(msgs), /Download Report|download/i);
  const data = msgs.at(-1).quickReply.items.map((i) => i.action.data);
  assert.ok(data.includes("section=1.4.1"));
  assert.ok(msgs.some((m) => m.type === "image")); // category screenshot
});

await ok("FAQ suggestions list top matches as faq= postbacks", () => {
  const results = [
    { no: 31, faq: faqByNo.get(31) },
    { no: 30, faq: faqByNo.get(30) },
  ];
  const data = buildFaqSuggestions(results, "en")[0].quickReply.items.map((i) => i.action.data);
  assert.ok(data.includes("faq=31") && data.includes("faq=30"));
});

await ok("postback faq=49 returns that FAQ's answer", () => {
  assert.match(textOf(handlePostback("faq=49", BASE, "en")), /download/i);
});

await ok("typed section number / FAQ number / menu route without the model", async () => {
  assert.match(textOf(await handleText("1.3.1", BASE, "en")), /Pause Screen/);
  assert.match(textOf(await handleText("29", BASE, "en")), /Due Date|Cut Off/i); // FAQ #29
  assert.equal((await handleText("menu", BASE, "en"))[0].quickReply.items.length, 8);
});

await ok("no reply exceeds 5 messages / 5000 chars (both langs)", () => {
  for (const lang of ["th", "en"]) {
    for (const id of ["1.1", "1.4.1", "1.3.7", "1.2.4"]) {
      const m = buildSection(id, BASE, lang);
      assert.ok(m.length <= 5 && textOf(m).length <= 5000, `${id}/${lang}`);
    }
  }
});

await ok("no broken ligature glyphs; quick-reply labels <= 20 chars", () => {
  assert.doesNotMatch(textOf(buildSection("1.1.1", BASE, "en")), /[-]/);
  for (const item of buildSection("1.2", BASE, "en").at(-1).quickReply.items) {
    assert.ok(item.action.label.length <= 20, item.action.label);
  }
});

console.log(`\n${passed} checks passed.`);
