// Chat/event log. Every inbound LINE event and the bot's outbound reply is
// recorded so the full chat history can be exported and queried later (the
// Messaging API does NOT let you fetch past messages — if we don't record it
// here, it's gone).
//
// This module only builds the record and hands it to a sink; the storage
// backend (Postgres / local JSONL / off) is chosen by the event-sink seam.
import { createEventSink } from "./log/event-sink.js";

const sink = createEventSink();

// Trim an outbound message object down to the fields worth keeping in history.
function summarize(m) {
  const s = { type: m?.type };
  if (m?.type === "text") s.text = m.text;
  else if (m?.type === "image") s.url = m.originalContentUrl;
  else if (m?.type === "flex" || m?.type === "template") s.altText = m.altText;
  return s;
}

// Log an inbound event from the LINE webhook (message, follow, unfollow,
// postback, etc.). Captures text and postback payloads in full.
export function logInbound(event) {
  const rec = {
    ts: new Date().toISOString(),
    dir: "in",
    userId: event?.source?.userId ?? null,
    type: event?.type ?? "unknown",
  };
  if (event?.type === "message") {
    rec.messageType = event.message?.type;
    if (event.message?.type === "text") rec.text = event.message.text;
  } else if (event?.type === "postback") {
    rec.postback = event.postback?.data;
  }
  return sink.write(rec);
}

// Log the bot's outbound reply to a given inbound event.
export function logOutbound(event, messages) {
  return sink.write({
    ts: new Date().toISOString(),
    dir: "out",
    userId: event?.source?.userId ?? null,
    type: event?.type ?? "unknown", // the inbound event this reply answers
    count: Array.isArray(messages) ? messages.length : 0,
    messages: Array.isArray(messages) ? messages.map(summarize) : [],
  });
}
