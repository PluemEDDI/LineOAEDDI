#!/usr/bin/env node
// One-shot seed script: reads the 7 JSON files from disk and upserts them
// into MongoDB as singleton documents.
//
// Run ONCE before switching to CONTENT_BACKEND=mongo:
//   npm run seed
//   (uses MONGODB_URI from .env)
//
// Safe to re-run — each upsert replaces the existing document so no
// duplicates are created.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MongoClient } from "mongodb";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("❌  MONGODB_URI is not set. Run with --env-file=.env");
  process.exit(1);
}

// Map: MongoDB collection name → path to the JSON file (relative to ROOT).
const FILES = [
  { col: "content",                 file: "content.json" },
  { col: "faq",                     file: "faq.json" },
  { col: "faq_th",                  file: "faq.th.json" },
  { col: "intents",                 file: "intents.json" },
  { col: "translations_th",         file: "translations.th.json" },
  { col: "richmenu_areas",          file: "richmenu-areas.json" },
  { col: "richmenu_sections_areas", file: "richmenu-sections-areas.json" },
];

async function seed() {
  const client = new MongoClient(uri);
  await client.connect();

  const dbName = new URL(uri).pathname.replace(/^\//, "") || "manualfaq";
  const db = client.db(dbName);
  console.log(`\n🌱  Seeding database: ${dbName}\n`);

  let ok = 0;
  let skipped = 0;

  for (const { col, file } of FILES) {
    const fullPath = join(ROOT, file);
    if (!existsSync(fullPath)) {
      console.warn(`  ⚠  Skipping ${col} — file not found: ${file}`);
      skipped++;
      continue;
    }

    const data = JSON.parse(readFileSync(fullPath, "utf8"));
    await db.collection(col).replaceOne(
      { _id: "singleton" },
      { _id: "singleton", data },
      { upsert: true }
    );
    const preview = JSON.stringify(data).slice(0, 60);
    console.log(`  ✅  ${col.padEnd(28)} ← ${file}  (${preview}…)`);
    ok++;
  }

  await client.close();

  console.log(`\n🎉  Done — ${ok} collection(s) seeded, ${skipped} skipped.`);
  if (ok > 0) {
    console.log(
      "\nNext steps:\n" +
        "  1. Add CONTENT_BACKEND=mongo to your hosting env vars (Railway, etc.).\n" +
        "  2. Restart the process — no redeploy needed.\n" +
        "  3. To update content later: edit the document in MongoDB Atlas,\n" +
        "     then restart the process.\n"
    );
  }
}

seed().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
