// Live semantic-search check — loads the embedding model (needs the model
// cached/downloaded). Separate from `npm test` so the main suite stays fast.
// Run: npm run test:search
import assert from "node:assert/strict";
import { search, classify } from "../src/faq.js";

let passed = 0;
const ok = (name, cond, info) => {
  assert.ok(cond, `${name} ${info ?? ""}`);
  console.log("  ✓", name);
  passed++;
};

// [query, expected top-match FAQ no, expected verdict]
const cases = [
  ["how do I download the class report?", 49, "answer"],
  ["วิธีดาวน์โหลดรายงานผลการเรียน", 49, null], // TH cross-lingual
  ["what is the difference between due date and cut off?", 29, "answer"],
  ["ความต่างระหว่าง due date กับ cut off", 29, "answer"],
  // Group vs breakout-room grouping are genuinely close, so a "did you mean"
  // is the right behavior here — assert the top match only, not the verdict.
  ["how to split students into groups", 32, null],
];

for (const [q, expectNo, expectVerdict] of cases) {
  const r = await search(q, 3);
  ok(`"${q.slice(0, 30)}" -> #${r[0].no} (${r[0].score.toFixed(2)})`,
     r[0].no === expectNo, `expected #${expectNo}`);
  if (expectVerdict) {
    ok(`  verdict = ${expectVerdict}`, classify(r) === expectVerdict, `got ${classify(r)}`);
  }
}

// Irrelevant query must NOT produce a confident answer.
const junk = await search("what is the weather today", 3);
ok(`junk query rejected (${classify(junk)})`, classify(junk) !== "answer");

console.log(`\n${passed} checks passed.`);
