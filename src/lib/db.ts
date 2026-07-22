import { Pool } from "pg";
import type { PoolClient } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";

const globalForDb = globalThis as unknown as { pool: Pool | undefined };

const pool =
  globalForDb.pool ??
  new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || "5432"),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === "false" ? false : {
      rejectUnauthorized: false,
    },
    min: 1,
    // Connection ceiling per running instance. Defaults to 10 (pg's own default,
    // made explicit alongside the shared-Postgres max_connections budget), but
    // overridable via DATABASE_POOL_MAX so a local dev server can hold a small
    // pool and avoid starving a connection-tight shared DB (e.g. staging).
    max: parseInt(process.env.DATABASE_POOL_MAX || "10", 10),
    // Fail fast instead of hanging forever if the pool can't hand out a
    // connection (e.g. all 10 busy or the DB is unreachable). The request
    // errors in 5s rather than blocking a server worker indefinitely.
    connectionTimeoutMillis: 5000,
    // Cap any single query at 15s. Without this a stuck query never settles, so
    // the `finally { client.release() }` below never runs and the connection
    // leaks out of the pool for good — repeat that and the pool is exhausted.
    // The timeout turns a hang into a normal error, so the connection is freed.
    statement_timeout: 15000,
    // Same idea for a transaction left open mid-flight (BEGIN without COMMIT).
    idle_in_transaction_session_timeout: 15000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

const transactionContext = new AsyncLocalStorage<boolean>();

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (transactionContext.getStore()) {
    throw new Error("Nested transactions are not supported");
  }

  const client = await pool.connect();
  let transactionStarted = false;

  return transactionContext.run(true, async () => {
    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }
      throw error;
    } finally {
      client.release();
    }
  });
}

export default pool;
