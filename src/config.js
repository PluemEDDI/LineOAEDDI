// Single source of tunable knobs. Defaults live here; env vars override them,
// so production tuning (e.g. raising FAQ_HIGH) does NOT require a code change
// — only a redeploy with new env. Validated at module load: malformed values
// crash the boot rather than silently falling back.

function num(envName, def, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[envName];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`config: ${envName}="${raw}" is not a number`);
  }
  if (n < min || n > max) {
    throw new Error(`config: ${envName}=${n} out of range [${min}, ${max}]`);
  }
  return n;
}

function str(envName, def) {
  const raw = process.env[envName];
  return raw && raw.length ? raw : def;
}

function bool(envName, def) {
  const raw = process.env[envName];
  if (raw === undefined || raw === "") return def;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`config: ${envName}="${raw}" must be true/false`);
}

// "HH:MM" 24-hour. Malformed values crash the boot rather than silently
// defaulting, matching num()/enumOpt() above.
function hhmm(envName, def) {
  const v = str(envName, def);
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  const h = m && Number(m[1]);
  const min = m && Number(m[2]);
  if (!m || h > 23 || min > 59) {
    throw new Error(`config: ${envName}="${v}" must be "HH:MM" (24-hour)`);
  }
  return v;
}

function enumOpt(envName, def, allowed) {
  const v = str(envName, def);
  if (!allowed.includes(v)) {
    throw new Error(
      `config: ${envName}="${v}" must be one of: ${allowed.join(", ")}`
    );
  }
  return v;
}

const _port = num("PORT", 3000, { min: 1, max: 65535 });

export const config = Object.freeze({
  faq: Object.freeze({
    // Confidence thresholds for src/faq.js classify().
    high: num("FAQ_HIGH", 0.45, { min: 0, max: 1 }),
    low: num("FAQ_LOW", 0.3, { min: 0, max: 1 }),
    gap: num("FAQ_GAP", 0.08, { min: 0, max: 1 }),
  }),
  intents: Object.freeze({
    // Min score (0–1) for src/intents.js classifyIntent() to fire a keyword
    // answer. Literal substring hits score 1.0; lower values tolerate more
    // typos via character-bigram fuzzy matching, at the cost of false fires.
    fuzzy: num("INTENT_FUZZY", 0.82, { min: 0, max: 1 }),
    // Lower bar (0–1) for tagging a human handoff with best-guess intent
    // labels. Below `fuzzy` on purpose: a handoff means nothing was confident
    // enough to answer, but weaker guesses still help the human triage. 0.6
    // is where spurious fuzzy tags drop out (tuned on the real chat data).
    tagMin: num("INTENT_TAG_MIN", 0.6, { min: 0, max: 1 }),
  }),
  handoff: Object.freeze({
    // Minutes before a still-open handoff is treated as a NEW support episode,
    // so the "a human will reply" reassurance is sent again instead of staying
    // silent. A Resolution_Closure ("ได้แล้ว/ขอบคุณ") clears it immediately.
    reassureCooldownMin: num("HANDOFF_REASSURE_COOLDOWN_MIN", 30, { min: 0, max: 1440 }),
    // Minutes the bot stays silent after an admin manually replies to a user.
    // Within this window, user acknowledgments (ได้ครับ, ขอบคุณ, etc.) are
    // suppressed so the bot doesn't interrupt an ongoing human conversation.
    adminReplyCooldownMin: num("ADMIN_REPLY_COOLDOWN_MIN", 10, { min: 0, max: 1440 }),
    // Minutes the bot stays silent after it fires an intent-matched reply.
    // This gives the admin a natural window to jump into the conversation
    // without the bot cutting in on every follow-up message.
    // Set to 0 to disable.
    botReplyCooldownMin: num("BOT_REPLY_COOLDOWN_MIN", 3, { min: 0, max: 60 }),
  }),
  // Discord "🔇 Silence bot" button: the /silence endpoint stamps adminRepliedAt
  // for a user so the bot goes quiet, letting the admin take over cleanly.
  // SILENCE_TOKEN is a shared secret that must be present in every /silence
  // request — prevents anyone with the URL from muting the bot arbitrarily.
  silence: Object.freeze({
    token: str("SILENCE_TOKEN", ""),
    // How long the bot stays silent after an admin clicks the Silence button.
    // Reuses ADMIN_REPLY_COOLDOWN_MIN so one knob controls both paths.
    cooldownMin: num("ADMIN_REPLY_COOLDOWN_MIN", 10, { min: 0, max: 1440 }),
  }),
  report: Object.freeze({
    // In-process daily report scheduler (src/scheduler.js). Off by default.
    // Needs DATABASE_URL (to read chat_events) and DISCORD_WEBHOOK_URL (to post).
    enabled: bool("REPORT_ENABLED", false),
    hour: num("REPORT_HOUR", 18, { min: 0, max: 23 }), // local hour in REPORT_TZ
    minute: num("REPORT_MINUTE", 0, { min: 0, max: 59 }),
    tz: str("REPORT_TZ", "Asia/Bangkok"),
    days: num("REPORT_DAYS", 1, { min: 1, max: 365 }), // window each run covers
  }),
  reply: Object.freeze({
    // LINE caps a reply at 5 messages; we use 4 images + 1 text.
    maxImages: num("REPLY_MAX_IMAGES", 4, { min: 1, max: 5 }),
    // LINE quick-reply label limit is 20 chars.
    qrLabelMax: num("REPLY_QR_LABEL_MAX", 20, { min: 5, max: 20 }),
  }),
  ui: Object.freeze({
    defaultLang: enumOpt("DEFAULT_LANG", "th", ["th", "en"]),
    // LINE text-message char limit is 5000; we cap body slice below that to
    // leave room for headers, sub-topic list, and hints.
    bodyMaxChars: num("BODY_MAX_CHARS", 4800, { min: 200, max: 5000 }),
  }),
  server: Object.freeze({
    port: _port,
    baseUrl: str("BASE_URL", `http://localhost:${_port}`).replace(/\/$/, ""),
  }),
  store: Object.freeze({
    // Used by the UserStore seam (C4). "memory" loses state on restart;
    // "file" persists to data/userlang.json on disk.
    kind: enumOpt("USER_STORE", "memory", ["memory", "file"]),
  }),
  log: Object.freeze({
    // Chat/event log backend (src/log/event-sink.js):
    //   "postgres" — durable, for ephemeral hosts (Railway + Supabase).
    //                 Requires DATABASE_URL.
    //   "file"     — append-only JSONL on local disk (default; good for local
    //                 dev, but LOST on ephemeral hosts that wipe disk).
    //   "none"     — logging off.
    // Path applies to the "file" backend; data/ is gitignored so the default
    // keeps user data out of version control.
    backend: enumOpt("LOG_BACKEND", "file", ["postgres", "file", "none"]),
    path: str("EVENT_LOG_PATH", "data/events.jsonl"),
    // Optional: forward the RAW LINE webhook payload to a Google Apps Script
    // web app that logs inbound text messages to a Sheet (see
    // src/log/sheet-forward.js). Independent of the backend above — the local/
    // DB log is unaffected. Unset = off. sheetToken is the script's optional
    // shared secret, sent as the ?token= query param.
    sheetUrl: str("SHEET_WEBHOOK_URL", ""),
    sheetToken: str("SHEET_WEBHOOK_TOKEN", ""),
  }),
  // Support business hours. A question the bot can't answer is handed to a
  // human — but only during these hours; outside them the bot says so. All
  // values are env-overridable so ops can change hours without a code change.
  hours: Object.freeze({
    tz: str("BUSINESS_TZ", "Asia/Bangkok"),
    open: hhmm("BUSINESS_OPEN", "08:30"),
    close: hhmm("BUSINESS_CLOSE", "17:30"),
    // Open days as IANA weekday numbers, 0=Sun … 6=Sat. Default Mon–Fri.
    days: str("BUSINESS_DAYS", "1,2,3,4,5"),
  }),
});

// Cross-field invariants: thresholds must form a sane ordering.
if (config.faq.high < config.faq.low) {
  throw new Error(
    `config: FAQ_HIGH (${config.faq.high}) must be >= FAQ_LOW (${config.faq.low})`
  );
}

// BUSINESS_DAYS must be a comma-list of weekday numbers 0–6.
for (const d of config.hours.days.split(",")) {
  const n = Number(d.trim());
  if (!Number.isInteger(n) || n < 0 || n > 6) {
    throw new Error(
      `config: BUSINESS_DAYS="${config.hours.days}" must be weekday numbers 0–6`
    );
  }
}
