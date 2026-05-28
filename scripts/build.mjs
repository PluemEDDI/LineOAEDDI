// build.mjs — atomic content build.
//
// Runs extract → build_faq → make_richmenu → validate. Before any step,
// backs up the current artifacts to .build-backup/; on any failure, restores
// from backup so the repo never holds a half-built state. On full success,
// the backup is discarded.
//
// CLI:
//   npm run build                          # uses defaults from env
//   MANUAL_PDF=/path FAQ_CSV=/path npm run build
import { spawnSync } from "node:child_process";
import {
  cpSync, rmSync, existsSync, mkdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP = join(ROOT, ".build-backup");

const PDF = process.env.MANUAL_PDF
  || join(homedir(), "Downloads", "Lecturer Manual.pdf");
const CSV = process.env.FAQ_CSV
  || join(homedir(), "Downloads", "Lecturer_FAQ.csv");

// Everything the pipeline produces. Backed up & restored atomically.
const ARTIFACTS = [
  "content.json",
  "faq.json",
  "faq-index.json",
  "richmenu.png",
  "richmenu-areas.json",
  "img",
  "preview",
];

function backup() {
  if (existsSync(BACKUP)) rmSync(BACKUP, { recursive: true, force: true });
  mkdirSync(BACKUP, { recursive: true });
  for (const a of ARTIFACTS) {
    const src = join(ROOT, a);
    if (existsSync(src)) cpSync(src, join(BACKUP, a), { recursive: true });
  }
}

function restore() {
  for (const a of ARTIFACTS) {
    const src = join(BACKUP, a);
    const dst = join(ROOT, a);
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
    if (existsSync(src)) cpSync(src, dst, { recursive: true });
  }
}

function cleanupBackup() {
  if (existsSync(BACKUP)) rmSync(BACKUP, { recursive: true, force: true });
}

function run(label, cmd, args) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

try {
  console.log("ManualFAQ build — atomic pipeline");
  console.log(`  PDF: ${PDF}`);
  console.log(`  CSV: ${CSV}`);
  backup();
  run("extract PDF",      "python3", ["scripts/extract.py", PDF]);
  run("build FAQ index",  "node",    ["scripts/build_faq.mjs", CSV]);
  run("build Rich Menu",  "python3", ["scripts/make_richmenu_image.py"]);
  run("validate",         "node",    ["scripts/validate.mjs"]);
  cleanupBackup();
  console.log("\n✓ Build successful");
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  console.error("Restoring previous artifacts from backup…");
  restore();
  cleanupBackup();
  process.exit(1);
}
