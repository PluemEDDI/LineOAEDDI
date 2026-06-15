// Forward the raw LINE webhook payload to a teammate's Google Sheet (an Apps
// Script web app). That script parses LINE's NATIVE event shape itself —
//   JSON.parse(e.postData.contents).events.forEach(ev => ... ev.message.text)
// — and appends inbound text messages to the Sheet. So we relay req.body
// verbatim, exactly as LINE sent it; we do NOT reshape it. The script ignores
// everything that isn't an inbound text message (bot replies, postbacks, etc.).
//
// Fire-and-forget: like the Discord notifier, a Sheet outage must never break
// or delay the LINE reply path, so this never throws and is not awaited by the
// webhook. Disabled (no-op) when SHEET_WEBHOOK_URL is unset.
import { config } from "../config.js";

const URL_BASE = config.log.sheetUrl;
const TOKEN = config.log.sheetToken;

// The Apps Script reads its secret from e.parameter.token, which is populated
// from the query string (the JSON body is consumed as the LINE payload). So
// the token rides on the URL, not in the body. Unset token → plain URL.
const TARGET = URL_BASE && TOKEN ? `${URL_BASE}?token=${encodeURIComponent(TOKEN)}` : URL_BASE;

// Relay one raw LINE webhook body ({ destination, events: [...] }) to the Sheet.
export function forwardToSheet(body) {
  if (!TARGET) return; // forwarding off
  if (!body || !Array.isArray(body.events) || body.events.length === 0) return;
  fetch(TARGET, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(async (r) => {
      // The script answers 200 with "ok" / "forbidden" / "error: ...". Surface
      // anything that isn't a clean "ok" so a misconfig (bad token, etc.) is
      // visible in the logs instead of silently dropping rows.
      const text = await r.text().catch(() => "");
      if (!r.ok || text.trim() !== "ok") {
        console.error("sheet-forward: unexpected response:", r.status, text.slice(0, 120));
      }
    })
    .catch((e) => console.error("sheet-forward error:", e?.message ?? e));
}
