// Singleton MongoDB client. connectMongo() is called once during server
// startup; every subsequent call returns the same cached client/db pair.
// The database name is parsed from the URI path, or defaults to "manualfaq".
import { MongoClient } from "mongodb";

let _client = null;
let _db = null;

/**
 * Connect to MongoDB (idempotent — safe to call multiple times).
 * Returns { client, db }.
 */
export async function connectMongo(uri) {
  if (_client) return { client: _client, db: _db };

  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add it to .env or set CONTENT_BACKEND=file to use local files."
    );
  }

  _client = new MongoClient(uri, {
    // Keep the connection pool small — this is a single-process bot, not a
    // web server farm. Railway free-tier containers are memory-constrained.
    maxPoolSize: 5,
  });
  await _client.connect();

  // Derive DB name from the URI path (e.g. /manualfaq) or fall back to default.
  const dbName = new URL(uri).pathname.replace(/^\//, "") || "manualfaq";
  _db = _client.db(dbName);

  console.log(`[mongo] connected — db: ${dbName}`);
  return { client: _client, db: _db };
}

/** Return the cached db handle (must have called connectMongo first). */
export function getDb() {
  if (!_db) throw new Error("[mongo] getDb() called before connectMongo()");
  return _db;
}

/** Close the connection (used in tests / graceful shutdown). */
export async function closeMongo() {
  if (_client) {
    await _client.close();
    _client = null;
    _db = null;
  }
}
