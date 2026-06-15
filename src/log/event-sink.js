// Event-sink seam: chooses the chat-log storage adapter by config, mirroring
// the UserStore seam in src/store/. The webhook only ever calls write(record);
// where that record lands is decided here.
//
//   LOG_BACKEND=postgres  → PgEventSink   (durable; for Railway/Supabase)
//   LOG_BACKEND=file      → FileEventSink  (local disk; lost on ephemeral hosts)
//   LOG_BACKEND=none      → NullEventSink  (logging off)
//
// (Forwarding the raw LINE payload to the team Google Sheet is a SEPARATE
// concern handled in the webhook by src/log/sheet-forward.js — that script
// wants LINE's native event shape, not the summarized records written here.)
import { config } from "../config.js";
import { FileEventSink } from "./file-sink.js";
import { PgEventSink } from "./pg-sink.js";

// No-op sink for when logging is disabled.
class NullEventSink {
  write() {
    return Promise.resolve();
  }
}

export function createEventSink() {
  switch (config.log.backend) {
    case "postgres":
      return new PgEventSink();
    case "file":
      return new FileEventSink({ path: config.log.path });
    case "none":
    default:
      return new NullEventSink();
  }
}
