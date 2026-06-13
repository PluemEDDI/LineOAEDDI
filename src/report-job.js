// Report orchestration: load inbound events from Postgres, build the report,
// and (optionally) post it to Discord. Shared by the CLI (scripts/report.mjs)
// and the in-process scheduler (src/scheduler.js). Kept separate from report.js
// so that module stays pure/testable (no DB, no network).
import pg from "pg";
import { buildReport, buildReportEmbed } from "./report.js";
import { sendEmbed } from "./notify.js";

// Load inbound chat events. `days` null = all-time; a number = last N days.
export async function loadRecentEvents(days = null) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL not set (report reads from the chat_events table).");
  }
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const sql = days
      ? `select ts, dir, user_id, body from chat_events
         where dir = 'in' and ts >= now() - ($1 || ' days')::interval`
      : `select ts, dir, user_id, body from chat_events where dir = 'in'`;
    const { rows } = await client.query(sql, days ? [String(days)] : []);
    return rows.map((r) => ({ ...r, ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts }));
  } finally {
    await client.end();
  }
}

// Load → build → optionally post. Returns { report, posted }.
export async function runReportJob({ days = 1, post = true } = {}) {
  const events = await loadRecentEvents(days);
  const report = buildReport(events);
  const posted = post ? await sendEmbed(buildReportEmbed(report)) : false;
  return { report, posted };
}
