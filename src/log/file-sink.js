// Append-only JSONL sink. For local dev or any host with a writable
// persistent disk. One JSON object per line. Writes are serialized through a
// promise chain so concurrent webhook events never tear each other's line.
import { appendFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export class FileEventSink {
  #path;
  #chain = Promise.resolve();
  #dirReady = false;

  constructor({ path = "data/events.jsonl" } = {}) {
    this.#path = isAbsolute(path) ? path : join(PROJECT_ROOT, path);
  }

  // Never throws — a logging failure must not break the webhook reply.
  write(record) {
    const line = JSON.stringify(record) + "\n";
    this.#chain = this.#chain.then(async () => {
      try {
        if (!this.#dirReady) {
          await mkdir(dirname(this.#path), { recursive: true });
          this.#dirReady = true;
        }
        await appendFile(this.#path, line);
      } catch (err) {
        console.error("event-log (file) write failed:", err?.message ?? err);
      }
    });
    return this.#chain;
  }
}
