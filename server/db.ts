import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Bound how long a single TCP connect may hang (node-postgres default is
  // unlimited). Without this, a blackholed DB route would stall the boot
  // retry loop and ordinary queries forever instead of failing fast.
  connectionTimeoutMillis: 10000,
});

// Without an 'error' listener, an error on an IDLE pooled client (e.g. the
// database restarting under us during a security update) is emitted as an
// uncaught exception and kills the whole process. Log it and let the pool
// discard the broken client; in-flight queries still reject normally and
// new queries get fresh connections once the database is back.
pool.on("error", (err) => {
  console.error(`[db] idle client error (pool will recover): ${err.message}`);
});

export const db = drizzle(pool, { schema });
