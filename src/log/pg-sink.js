// Postgres sink (Supabase). For ephemeral hosts (Railway, Heroku, Render)
// whose local disk is wiped on every restart/redeploy — chat history must
// live off the dyno. Connection comes from DATABASE_URL (Supabase → Project
// Settings → Database → Connection string). The target table is created on
// first write, so no manual migration step is required.
//
// Writes NEVER throw: a logging failure must not break the webhook reply.
import pg from "pg";

const { Pool } = pg;

const CREATE_SQL = `
  create table if not exists chat_events (
    id           bigserial primary key,
    ts           timestamptz not null,
    dir          text not null,            -- 'in' | 'out'
    user_id      text,
    type         text not null,            -- inbound event type, or replyTo for outbound
    message_type text,                     -- inbound message type (text/image/...)
    body         text,                     -- inbound text
    postback     text,                     -- inbound postback payload
    reply_count  integer,                  -- outbound message count
    messages     jsonb                     -- outbound message summaries
  );
  create index if not exists chat_events_user_ts on chat_events (user_id, ts);
  create index if not exists chat_events_type    on chat_events (type);
`;

const INSERT_SQL = `
  insert into chat_events
    (ts, dir, user_id, type, message_type, body, postback, reply_count, messages)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
`;

export class PgEventSink {
  #pool;
  #ready = null; // memoized table-creation promise

  constructor({ connectionString = process.env.DATABASE_URL } = {}) {
    if (!connectionString) {
      throw new Error(
        "event-log: LOG_BACKEND=postgres requires DATABASE_URL " +
          "(Supabase → Project Settings → Database → Connection string)."
      );
    }
    // Supabase requires TLS. rejectUnauthorized:false avoids bundling their CA;
    // the connection is still encrypted. Keep the pool small — a chat log is
    // low-volume and ephemeral hosts have tight connection limits.
    this.#pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }

  #ensureTable() {
    if (!this.#ready) {
      this.#ready = this.#pool.query(CREATE_SQL).catch((err) => {
        this.#ready = null; // allow retry on a later write
        throw err;
      });
    }
    return this.#ready;
  }

  async write(record) {
    try {
      await this.#ensureTable();
      await this.#pool.query(INSERT_SQL, [
        record.ts,
        record.dir,
        record.userId ?? null,
        record.type,
        record.messageType ?? null,
        record.text ?? null,
        record.postback ?? null,
        record.count ?? null,
        record.messages ? JSON.stringify(record.messages) : null,
      ]);
    } catch (err) {
      console.error("event-log (postgres) write failed:", err?.message ?? err);
    }
  }
}
