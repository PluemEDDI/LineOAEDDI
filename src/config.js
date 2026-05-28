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
});

// Cross-field invariants: thresholds must form a sane ordering.
if (config.faq.high < config.faq.low) {
  throw new Error(
    `config: FAQ_HIGH (${config.faq.high}) must be >= FAQ_LOW (${config.faq.low})`
  );
}
