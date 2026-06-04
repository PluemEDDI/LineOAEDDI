// Is the support team open right now? A question the bot can't answer is
// handed to a human during business hours; outside them the bot says so.
//
// All comparisons happen in the configured IANA time zone (default
// Asia/Bangkok) via Intl — the host's own clock zone is irrelevant.
import { config } from "./config.js";

const { tz, open, close, days } = config.hours;

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const OPEN_MIN = toMin(open);
const CLOSE_MIN = toMin(close);
const OPEN_DAYS = new Set(days.split(",").map((d) => Number(d.trim())));

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: tz,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Returns { day: 0–6, minutes: 0–1439 } for `date` in the configured zone.
function localParts(date) {
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    day: WEEKDAY[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// True when the configured zone's local time is within [open, close) on an
// open day. `date` is injectable for tests; defaults to now.
export function isBusinessHours(date = new Date()) {
  const { day, minutes } = localParts(date);
  return OPEN_DAYS.has(day) && minutes >= OPEN_MIN && minutes < CLOSE_MIN;
}
