// Google Sheet sink. Forwards each chat event to a Google Apps Script web app
// (a /macros/.../exec URL whose doPost(e) appends a row to a Sheet). Used to
// mirror the chat log into a Sheet a teammate owns, without giving them DB
// access. Normally wired as a TEE alongside the primary backend — see
// event-sink.js.
//
// Fire-and-forget: like the Discord notifier, a Sheet outage must never break
// the LINE reply path, so write() never throws. Apps Script answers a POST
// with a 302 redirect to googleusercontent.com; Node's fetch follows it.
export class SheetEventSink {
  #url;
  #chain = Promise.resolve();

  constructor({ url } = {}) {
    if (!url) throw new Error("event-log: SheetEventSink requires a url");
    this.#url = url;
  }

  // Serialized through a promise chain so rows POST in the order they happened
  // (Apps Script appends in arrival order; concurrent posts could interleave).
  write(record) {
    this.#chain = this.#chain.then(async () => {
      try {
        const r = await fetch(this.#url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(record),
        });
        if (!r.ok) {
          console.error(
            "event-log (sheet) write failed:",
            r.status,
            await r.text().catch(() => "")
          );
        }
      } catch (err) {
        console.error("event-log (sheet) write failed:", err?.message ?? err);
      }
    });
    return this.#chain;
  }
}

// Tee: write every record to all of the given sinks. Used to keep the primary
// log (file/postgres) AND mirror to the Sheet. Resolves once all have settled;
// one sink failing never rejects (each sink already swallows its own errors).
export class TeeEventSink {
  #sinks;
  constructor(sinks) {
    this.#sinks = sinks.filter(Boolean);
  }
  write(record) {
    return Promise.all(this.#sinks.map((s) => s.write(record)));
  }
}
