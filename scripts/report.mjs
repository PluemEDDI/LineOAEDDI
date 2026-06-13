// Support-case report CLI.
//
//   npm run report                  # all-time, from Postgres (DATABASE_URL)
//   npm run report -- --days 1      # last 24h (good for a daily cron)
//   npm run report -- --discord     # also post the summary to Discord
//   npm run report -- --csv path.csv  # from a CSV export instead of Postgres
//
// For the scheduled "auto summary" (option C), run with --days 1 --discord
// from a cron (Railway cron, GitHub Action, or system cron).
import { readFileSync } from "node:fs";
import { buildReport, formatReportText, buildReportEmbed } from "../src/report.js";
import { loadRecentEvents } from "../src/report-job.js";
import { sendEmbed } from "../src/notify.js";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const csvPath = opt("--csv");
const days = opt("--days") ? Number(opt("--days")) : null;
const toDiscord = args.includes("--discord");

// Minimal CSV parser (handles quoted, multiline bodies) → rows of header→value.
function loadCsv(path) {
  const raw = readFileSync(path, "utf8");
  const rows = [];
  let field = "",
    row = [],
    inQ = false;
  const endF = () => (row.push(field), (field = ""));
  const endR = () => {
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQ) {
      if (c === '"' && raw[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") endF();
    else if (c === "\n") (endF(), endR());
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) (endF(), endR());
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

let events = csvPath ? loadCsv(csvPath) : await loadRecentEvents(days);

// CSV path can't filter server-side; apply --days client-side if given.
if (csvPath && days) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  events = events.filter((e) => String(e.ts) >= cutoff);
}

const report = buildReport(events);
console.log(formatReportText(report));

if (toDiscord) {
  const ok = await sendEmbed(buildReportEmbed(report));
  console.log(ok ? "\n✓ posted to Discord" : "\n✗ Discord post skipped/failed");
}
