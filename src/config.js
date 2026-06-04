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
