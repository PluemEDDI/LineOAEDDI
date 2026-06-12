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
  return {
    title,
    description: quoted,
    color: businessHours ? 0xe67e22 : 0x5865f2,
    fields: [
      {
        name: "Tags",
        value: tags?.length ? tags.map((t) => `\`${t}\``).join(" ") : "`uncategorized`",
      },
      { name: "User", value: user, inline: true },
      {
        name: "Status",
        value: businessHours
          ? "Within business hours — bot stayed silent"
          : "After hours — afterHours reply sent",
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

// Build the full webhook payload. Handlers are @mentioned only on a NEW
// handoff (not every follow-up), and `allowed_mentions` is locked to exactly
// those user IDs so @everyone/@here/role pings can never fire by accident.
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
