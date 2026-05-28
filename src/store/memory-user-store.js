// In-process Map. State is lost on restart — honest default for ephemeral
// hosts (Cloud Run, Fly, Render free). The user's accepted trade-off
// (per the architecture review) is "users re-pick if it forgets."
export class MemoryUserStore {
  #data = new Map(); // userId -> Map<key, value>
  static #warned = false;

  constructor() {
    if (!MemoryUserStore.#warned) {
      console.warn(
        "USER_STORE=memory — per-user state will not survive restart. " +
          "Users may need to re-pick language after deploys."
      );
      MemoryUserStore.#warned = true;
    }
  }

  get(userId, key) {
    return this.#data.get(userId)?.get(key);
  }

  async set(userId, key, value) {
    if (!this.#data.has(userId)) this.#data.set(userId, new Map());
    this.#data.get(userId).set(key, value);
  }
}
