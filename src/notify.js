// Discord notification for human handoffs. When a free-text message can't be
// auto-answered, the team gets a structured alert with the message, the user,
// and best-guess intent tags — important because in business hours the bot
// stays silent (a human replies via the LINE console), so this is their cue.
//
// Fire-and-forget: a webhook outage must never break the LINE reply path, and
// we never await it (reply tokens expire). Disabled (no-op) when
// DISCORD_WEBHOOK_URL is unset, so local/dev runs need no extra config.
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || "";

// Discord user IDs to @mention so only the LINE OA handler(s) get a ping —
// everyone else in the channel just sees the message. Comma-separated; empty
// means nobody is pinged (the embed posts silently).
const HANDLER_IDS = (process.env.DISCORD_HANDLER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Used to build the /silence URL embedded in the Discord embed.
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const SILENCE_TOKEN = process.env.SILENCE_TOKEN || "";
const SILENCE_COOLDOWN_MIN = Number(process.env.ADMIN_REPLY_COOLDOWN_MIN ?? 10);

// Build the Discord embed payload. Pure — no I/O — so it's unit-testable.
export function buildHandoffEmbed({ userId, displayName, text, tags, businessHours, followUp }) {
  const quoted = text ? `> ${String(text).replace(/\n/g, "\n> ")}` : "_(no text)_";
  const title = followUp
    ? "↪ Handoff follow-up (reassurance already sent)"
    : businessHours
      ? "🙋 Human handoff needed (in hours)"
      : "🌙 Handoff queued (after hours)";
  // Prefer the LINE display name; keep the userId underneath for traceability.
  const user = displayName
    ? `${displayName}${userId ? `\n\`${userId}\`` : ""}`
    : userId
      ? `\`${userId}\``
      : "unknown";

  // Build the silence hyperlink when the endpoint is configured.
  // Regular Discord incoming webhooks don't support components/buttons, so we
  // embed the link directly in the embed as a Discord markdown hyperlink.
  const silenceUrl =
    BASE_URL && SILENCE_TOKEN && userId
      ? `${BASE_URL}/silence?uid=${encodeURIComponent(userId)}&token=${encodeURIComponent(SILENCE_TOKEN)}`
      : null;

  const fields = [
    {
      name: "Tags",
      value: tags?.length ? tags.map((t) => `\`${t}\``).join(" ") : "`uncategorized`",
    },
    { name: "User", value: user, inline: true },
    {
      name: "Status",
      value: businessHours
        ? "Within business hours \u2014 bot stayed silent"
        : "After hours \u2014 afterHours reply sent",
      inline: true,
    },
  ];

  // Silence link as its own field so it's easy to spot and tap on mobile.
  if (silenceUrl) {
    fields.push({ name: "\u200b", value: `[🔇 Silence bot for ${Math.round(SILENCE_COOLDOWN_MIN)} min](${silenceUrl})`, inline: false });
  }

  return {
    title,
    description: quoted,
    color: businessHours ? 0xe67e22 : 0x5865f2,
    fields,
    timestamp: new Date().toISOString(),
  };
}

// Build the full webhook payload. Handlers are @mentioned only on a NEW
// handoff (not every follow-up), and `allowed_mentions` is locked to exactly
// those user IDs so @everyone/@here/role pings can never fire by accident.
// The 🔇 silence link is embedded directly inside the embed (see buildHandoffEmbed)
// because regular Discord incoming webhooks don't support components/buttons.
export function buildHandoffPayload(info, handlerIds = HANDLER_IDS) {
  const mention =
    !info.followUp && handlerIds.length
      ? handlerIds.map((id) => `<@${id}>`).join(" ")
      : "";
  return {
    ...(mention ? { content: mention } : {}),
    embeds: [buildHandoffEmbed(info)],
    allowed_mentions: { parse: [], users: handlerIds },
  };
}

// Post a single embed and AWAIT the result — for scripts (e.g. the report job)
// that need to know it landed and then exit. Returns true on success, false if
// the webhook is unset or the post failed. Never throws.
export async function sendEmbed(embed) {
  if (!WEBHOOK) {
    console.warn("DISCORD_WEBHOOK_URL not set — skipping Discord post.");
    return false;
  }
  try {
    const r = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    });
    if (!r.ok) console.error("discord post failed:", r.status, await r.text().catch(() => ""));
    return r.ok;
  } catch (e) {
    console.error("discord post error:", e?.message || e);
    return false;
  }
}

export function notifyHandoff(info) {
  if (!WEBHOOK) return;
  const body = JSON.stringify(buildHandoffPayload(info));
  fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
    .then(async (r) => {
      if (!r.ok) {
        console.error("discord notify failed:", r.status, await r.text().catch(() => ""));
      }
    })
    .catch((e) => console.error("discord notify error:", e?.message || e));
}
