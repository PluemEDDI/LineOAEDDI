// Support-case reporting. Takes logged chat events (from the chat_events table
// or a CSV export) and derives a per-intent breakdown by replaying each inbound
// message through the SAME router the bot uses — so the report reflects exactly
// what the bot did (auto-answered vs handed off), with no separate label store.
import { routeText } from "./messages.js";

// Build an aggregate report from raw events. Each event: { dir, user_id, ts, body }.
// Only inbound text is classified; outbound and non-text rows are ignored.
export function buildReport(events) {
  const inbound = events.filter((e) => e.dir === "in" && (e.body ?? "").trim());

  const counts = new Map(); // category -> count
  const unmatched = new Map(); // normalized body -> count
  const users = new Set();
  let handoff = 0;
  let from = null;
  let to = null;

  for (const e of inbound) {
    if (e.user_id) users.add(e.user_id);
    if (e.ts) {
      const ts = String(e.ts);
      if (!from || ts < from) from = ts;
      if (!to || ts > to) to = ts;
    }
    const r = routeText(e.body, "", "th");
    let category;
    if (r.handoff) {
      category = "(handoff)";
      handoff++;
      const key = e.body.replace(/\s+/g, " ").trim();
      unmatched.set(key, (unmatched.get(key) || 0) + 1);
    } else {
      category = r.intent || "(navigation/command)";
    }
    counts.set(category, (counts.get(category) || 0) + 1);
  }

  const total = inbound.length;
  const pct = (n) => (total ? Math.round((100 * n) / total) : 0);
  const resolved = counts.get("Resolution_Closure") || 0;

  return {
    total,
    users: users.size,
    handoff,
    handoffRate: pct(handoff),
    resolved,
    resolutionRate: pct(resolved), // closure messages as % of inbound (proxy)
    window: { from, to },
    byCategory: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([intent, count]) => ({ intent, count, pct: pct(count) })),
    topUnmatched: [...unmatched.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([body, count]) => ({ body, count })),
  };
}

// Plain-text report for the console / logs.
export function formatReportText(r) {
  const lines = [];
  lines.push("══ Support case report ══");
  lines.push(`window : ${r.window.from ?? "?"}  →  ${r.window.to ?? "?"}`);
  lines.push(`inbound: ${r.total} messages from ${r.users} users`);
  lines.push(`handoff: ${r.handoff} (${r.handoffRate}%)   resolved(closure): ${r.resolved} (${r.resolutionRate}%)`);
  lines.push("");
  lines.push("By category:");
  for (const c of r.byCategory) {
    lines.push(`  ${String(c.count).padStart(4)}  ${String(c.pct).padStart(3)}%  ${c.intent}`);
  }
  if (r.topUnmatched.length) {
    lines.push("");
    lines.push("Top unmatched (→ candidate new keywords):");
    for (const u of r.topUnmatched) {
      lines.push(`  ${String(u.count).padStart(3)}×  ${u.body.slice(0, 60)}`);
    }
  }
  return lines.join("\n");
}

// Discord embed for the scheduled summary. Kept within Discord field limits.
export function buildReportEmbed(r) {
  const cats = r.byCategory
    .map((c) => `\`${String(c.count).padStart(3)}\` ${c.pct}% — ${c.intent}`)
    .join("\n")
    .slice(0, 1024) || "—";
  const unmatched =
    r.topUnmatched.map((u) => `\`${u.count}×\` ${u.body.slice(0, 50)}`).join("\n").slice(0, 1024) ||
    "—";
  return {
    title: "📊 Support case report",
    description: `**${r.total}** messages · **${r.users}** users\nHandoff **${r.handoffRate}%** · Resolved **${r.resolutionRate}%**\n\`${r.window.from ?? "?"}\` → \`${r.window.to ?? "?"}\``,
    color: 0x3498db,
    fields: [
      { name: "By category", value: cats },
      { name: "Top unmatched (improve keywords)", value: unmatched },
    ],
    timestamp: new Date().toISOString(),
  };
}
