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
  routeText,
  buildHandoffMessage,
  shouldReassure,
} from "../src/messages.js";
import { classifyIntent, intentTags } from "../src/intents.js";
import { buildHandoffEmbed, buildHandoffPayload } from "../src/notify.js";
import { buildReport } from "../src/report.js";
import { faqByNo } from "../src/faq.js";
import { t } from "../src/content.js";
import { isBusinessHours } from "../src/hours.js";
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
  assert.match(img.originalContentUrl, /1\.3\.1_13_1\.png$/);
  assert.match(img.previewImageUrl, /\/preview\/1\.3\.1_13_1\.png$/);
  assert.match(textOf(msgs), /Mini Player/);
});

await ok("Thai vs English render the right title", () => {
  assert.match(textOf(buildSection("1.3.1", BASE, "th")), /หน้าจอย่อ/);
  assert.match(textOf(buildSection("1.3.1", BASE, "en")), /Mini Player/);
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

await ok("FAQ answer includes the question, answer, and section button", () => {
  const faq = faqByNo.get(16); // download lecture material (Courses -> 1.2.2)
  const msgs = buildFaqAnswer(faq, BASE, "en");
  assert.match(textOf(msgs), /download/i);
  const data = msgs.at(-1).quickReply.items.map((i) => i.action.data);
  assert.ok(data.includes("section=1.2.2"));
});

await ok("FAQ suggestions list top matches as faq= postbacks", () => {
  const results = [
    { no: 31, faq: faqByNo.get(31) },
    { no: 30, faq: faqByNo.get(30) },
  ];
  const data = buildFaqSuggestions(results, "en")[0].quickReply.items.map((i) => i.action.data);
  assert.ok(data.includes("faq=31") && data.includes("faq=30"));
});

await ok("postback faq=16 returns that FAQ's answer", () => {
  assert.match(textOf(handlePostback("faq=16", BASE, "en")), /download/i);
});

await ok("typed section number / FAQ number / menu route without the model", async () => {
  assert.match(textOf(await handleText("1.3.1", BASE, "en")), /Mini Player/);
  assert.match(textOf(await handleText("29", BASE, "en")), /group/i); // FAQ #29
  assert.equal((await handleText("menu", BASE, "en"))[0].quickReply.items.length, 8);
});

await ok("business hours: Mon–Fri 8:30–17:30 Asia/Bangkok (env defaults)", () => {
  // Bangkok is UTC+7, so the UTC instants below map to local times shown.
  assert.equal(isBusinessHours(new Date("2026-06-08T03:00:00Z")), true);  // Mon 10:00
  assert.equal(isBusinessHours(new Date("2026-06-08T00:00:00Z")), false); // Mon 07:00 (before open)
  assert.equal(isBusinessHours(new Date("2026-06-08T11:00:00Z")), false); // Mon 18:00 (after close)
  assert.equal(isBusinessHours(new Date("2026-06-13T05:00:00Z")), false); // Sat 12:00 (closed day)
  assert.equal(isBusinessHours(new Date("2026-06-08T01:30:00Z")), true);  // Mon 08:30 (open edge)
  assert.equal(isBusinessHours(new Date("2026-06-08T10:30:00Z")), false); // Mon 17:30 (close edge, exclusive)
});

await ok("unanswerable question is a handoff with tags; routeText sends no auto-reply", () => {
  const r = routeText("ส่ง file แล้วหายทำยังไง", BASE, "th");
  assert.equal(r.handoff, true);
  assert.deepEqual(r.messages, []);            // reassurance is server-managed + deduped
  assert.ok(Array.isArray(r.tags));
  assert.equal(typeof r.businessHours, "boolean");
});

await ok("a known intent auto-answers and is not a handoff", () => {
  const r = routeText("เข้าไม่ได้ครับ", BASE, "th");
  assert.equal(r.handoff, false);
  assert.equal(r.intent, "Authentication_Access");
  assert.equal(r.messages[0].type, "text");
});

await ok("closure never fires Authentication; negated closure is not a closure", () => {
  assert.equal(classifyIntent("เข้าได้แล้วค่ะ ขอบคุณ").name, "Resolution_Closure");
  assert.equal(classifyIntent("เข้าได้แล้ว(ไม่ได้)"), null); // negator suppresses
});

await ok("intent tags are best-guess, capped at 3, no spurious labels", () => {
  assert.deepEqual(intentTags("เข้าระบบ eddi ไม่ค่อยจะได้"), ["Authentication_Access"]);
  assert.deepEqual(intentTags("อยากกินข้าวเย็น"), []); // unrelated → no tags
  assert.ok(intentTags("xxxxxxxxxx").length <= 3);
});

await ok("reassurance sent once per episode, re-sent only after cooldown", () => {
  const COOL = 30 * 60_000;
  assert.equal(shouldReassure(0, 1_000_000, COOL), true);                  // no prior → reassure
  assert.equal(shouldReassure(1_000_000, 1_000_000 + 60_000, COOL), false); // 1 min later → silent
  assert.equal(shouldReassure(1_000_000, 1_000_000 + COOL + 1, COOL), true); // past cooldown → reassure
});

await ok("handoff reassurance: handover in hours, afterHours outside", () => {
  assert.equal(buildHandoffMessage("th", true)[0].text, t("th", "handover"));
  assert.equal(buildHandoffMessage("en", false)[0].text, t("en", "afterHours"));
});

await ok("Discord embed carries message, tags, user; falls back to uncategorized", () => {
  const e = buildHandoffEmbed({ userId: "Uabc", displayName: "สมชาย", text: "ช่วยด้วย", tags: ["Authentication_Access"], businessHours: true });
  assert.match(e.description, /ช่วยด้วย/);
  assert.match(e.fields[0].value, /Authentication_Access/);
  assert.match(e.fields[1].value, /สมชาย/);       // name shown
  assert.match(e.fields[1].value, /`Uabc`/);       // userId kept for traceability
  assert.equal(buildHandoffEmbed({ userId: "Uxyz", text: "x", businessHours: true }).fields[1].value, "`Uxyz`"); // no name → userId
  const none = buildHandoffEmbed({ userId: null, text: "", tags: [], businessHours: false });
  assert.match(none.fields[0].value, /uncategorized/);
  const followUp = buildHandoffEmbed({ userId: "U1", text: "x", tags: [], businessHours: true, followUp: true });
  assert.match(followUp.title, /follow-up/);
});

await ok("only handler IDs are pinged; new handoff mentions, follow-up stays silent", () => {
  const info = { userId: "U1", text: "x", tags: [], businessHours: true };
  const p = buildHandoffPayload(info, ["111", "222"]);
  assert.equal(p.content, "<@111> <@222>");                 // handlers pinged
  assert.deepEqual(p.allowed_mentions, { parse: [], users: ["111", "222"] }); // nobody else can ping
  // Follow-ups don't ping even the handlers.
  assert.equal(buildHandoffPayload({ ...info, followUp: true }, ["111"]).content, undefined);
  // No configured handlers → no ping at all.
  const none = buildHandoffPayload(info, []);
  assert.equal(none.content, undefined);
  assert.deepEqual(none.allowed_mentions, { parse: [], users: [] });
});

await ok("report aggregates inbound by category, handoff and resolution", () => {
  const events = [
    { dir: "in", user_id: "U1", ts: "2026-06-11T05:00:00Z", body: "เข้าไม่ได้ครับ" },     // Auth
    { dir: "in", user_id: "U1", ts: "2026-06-11T05:05:00Z", body: "ได้แล้วครับ ขอบคุณ" }, // Closure
    { dir: "in", user_id: "U2", ts: "2026-06-11T05:10:00Z", body: "ส่ง file หายทำไง" },    // handoff
    { dir: "out", user_id: "U1", ts: "2026-06-11T05:06:00Z", body: null },                  // ignored
    { dir: "in", user_id: "U2", ts: "2026-06-11T05:11:00Z", body: "   " },                  // ignored (empty)
  ];
  const r = buildReport(events);
  assert.equal(r.total, 3);
  assert.equal(r.users, 2);
  assert.equal(r.handoff, 1);
  assert.equal(r.resolved, 1);
  assert.ok(r.byCategory.find((c) => c.intent === "Authentication_Access"));
  assert.equal(r.topUnmatched[0].body, "ส่ง file หายทำไง");
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
