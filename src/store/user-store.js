// UserStore — the seam for per-user state.
//
// Two adapters ship: MemoryUserStore (default, for ephemeral hosts) and
// FileUserStore (persistent disk, for VPS). A third — Redis or similar —
// could later land behind the same interface without touching server.js.
//
// Interface contract:
//   get(userId, key) -> value | undefined           (sync; reads from cache)
//   set(userId, key, value) -> Promise<void>        (async; persists if needed)
//
// `lang` is the only key today, but the interface is keyed so future state
// (bookmarks, recent FAQs, dismissed prompts) can ride the same seam.

import { config } from "../config.js";
import { MemoryUserStore } from "./memory-user-store.js";
import { FileUserStore } from "./file-user-store.js";

export function createUserStore() {
  return config.store.kind === "file"
    ? new FileUserStore()
    : new MemoryUserStore();
}

export { MemoryUserStore, FileUserStore };
