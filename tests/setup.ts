import { beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { runMigrations } from '../db/migrations/migrate.js';
import { getConfig } from '../config.js';
import { initPool, getPool } from '../extensions/db.js';

beforeAll(async () => {
  const config = getConfig('testing');
  // Initialize pool for the test runner's setup operations
  initPool(config);
});

async function resetSchema() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    // 1. Take an advisory lock to ensure only one process/test is resetting the DB at a time
    await client.query('SELECT pg_advisory_lock(1)');

    // 2. Kill other connections to the test DB to prevent catalog locks/collisions
    await client.query(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = current_database() AND pid <> pg_backend_pid()
    `);

    // 3. Wipe the public schema
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');

    // 4. Release lock
    await client.query('SELECT pg_advisory_unlock(1)');
  } catch (err) {
    console.error('Failed to reset public schema:', err);
    throw err;
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  const config = getConfig('testing');
  await resetSchema();
  // Small delay to ensure PG is ready
  await new Promise(resolve => setTimeout(resolve, 100));
  await runMigrations(config.databaseUrl);
});

afterEach(async () => {
  await resetSchema();
});

afterAll(async () => {
  const pool = getPool();
  await pool.end();
});
