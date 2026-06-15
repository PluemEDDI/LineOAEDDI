// Event-sink seam: chooses the chat-log storage adapter by config, mirroring
// the UserStore seam in src/store/. The webhook only ever calls write(record);
// where that record lands is decided here.
//
//   LOG_BACKEND=postgres  → PgEventSink   (durable; for Railway/Supabase)
//   LOG_BACKEND=file      → FileEventSink  (local disk; lost on ephemeral hosts)
//   LOG_BACKEND=none      → NullEventSink  (logging off)
//
// Independently, if SHEET_WEBHOOK_URL is set, every event is ALSO forwarded to
// a Google Sheet (Apps Script web app) — the primary backend above is teed
// with a SheetEventSink so nothing is lost from the local/DB copy.
import { config } from "../config.js";
import { FileEventSink } from "./file-sink.js";
import { PgEventSink } from "./pg-sink.js";
import { SheetEventSink, TeeEventSink } from "./sheet-sink.js";

// No-op sink for when logging is disabled.
class NullEventSink {
  write() {
    return Promise.resolve();
  }
}

function createPrimarySink() {
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

export function createEventSink() {
  const primary = createPrimarySink();
  if (config.log.sheetUrl) {
    return new TeeEventSink([primary, new SheetEventSink({ url: config.log.sheetUrl })]);
  }
  return primary;
}
