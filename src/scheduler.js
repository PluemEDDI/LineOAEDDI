// In-process daily scheduler for the support-case report. Runs inside the
// always-on bot, so no separate cron service is needed. Off by default; enable
// with REPORT_ENABLED=true (see config.report).
import { config } from "./config.js";
import { runReportJob } from "./report-job.js";

const pad = (n) => String(n).padStart(2, "0");

// Milliseconds until the next HH:MM in the given IANA timezone. Pure +
// testable. Assumes the tz offset is stable over the next 24h — true for
// Asia/Bangkok (no DST); a DST-changing tz could drift by 1h twice a year,
// which is acceptable for a daily report.
export function msUntil(hour, minute, tz, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)])
  );
  const nowSec = (parts.hour % 24) * 3600 + parts.minute * 60 + parts.second;
  let delta = hour * 3600 + minute * 60 - nowSec;
  if (delta <= 0) delta += 86400; // already passed today → next day
  return delta * 1000;
}

// Start the recurring daily report. No-op unless enabled and DATABASE_URL is
// set. Each fire reschedules the next one (so it survives indefinitely).
export function startReportScheduler() {
  if (!config.report.enabled) return;
  if (!process.env.DATABASE_URL) {
    console.warn("report scheduler: REPORT_ENABLED but DATABASE_URL unset — not starting.");
    return;
  }
  const { hour, minute, tz, days } = config.report;

  const tick = () => {
    const wait = msUntil(hour, minute, tz);
    const timer = setTimeout(async () => {
      try {
        const { report, posted } = await runReportJob({ days, post: true });
        console.log(`report job ran: ${report.total} msgs, posted=${posted}`);
      } catch (e) {
        console.error("report job failed:", e?.message || e);
      }
      tick(); // schedule the next day
    }, wait);
    timer.unref?.(); // don't keep the process alive for this alone
  };

  tick();
  const mins = Math.round(msUntil(hour, minute, tz) / 60000);
  console.log(`report scheduler: daily ${pad(hour)}:${pad(minute)} ${tz} (next run in ~${mins} min)`);
}
