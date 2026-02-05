import * as schema from "./schema";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// Log pool errors (e.g., Neon terminating idle connections) instead of crashing
pool.on("error", (err) => {
  console.error("[pg.Pool] Unexpected pool error:", err.message);
});

const database = drizzle(pool, { schema, logger: true });

export { database, pool };
