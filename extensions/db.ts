import pg from "pg";
import type { AppConfig } from "../config.js";

let pool: pg.Pool | null = null;

export function initPool(config: AppConfig): void {
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.isProd ? 1 : 10,
    min: config.isProd ? 0 : 1,
  });
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error("Database pool not initialized.");
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
