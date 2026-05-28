// JSON-file-backed adapter. For VPS or any host with a writable persistent
// disk. Schema: { [userId]: { [key]: value } }.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROJECT_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const DEFAULT_PATH = join(PROJECT_ROOT, "data", "users.json");

export class FileUserStore {
  #data = new Map(); // userId -> Map<key, value>
  #path;

  // Path is injectable for tests; defaults to data/users.json.
  constructor({ path = DEFAULT_PATH } = {}) {
    this.#path = path;
    try {
      const raw = JSON.parse(readFileSync(this.#path, "utf8"));
      for (const [uid, kv] of Object.entries(raw)) {
        this.#data.set(uid, new Map(Object.entries(kv)));
      }
    } catch {
      // no file yet — first write will create it
    }
  }

  get(userId, key) {
    return this.#data.get(userId)?.get(key);
  }

  async set(userId, key, value) {
    if (!this.#data.has(userId)) this.#data.set(userId, new Map());
    this.#data.get(userId).set(key, value);
    const obj = Object.fromEntries(
      [...this.#data].map(([uid, kv]) => [uid, Object.fromEntries(kv)])
    );
    mkdirSync(dirname(this.#path), { recursive: true });
    writeFileSync(this.#path, JSON.stringify(obj));
  }
}
