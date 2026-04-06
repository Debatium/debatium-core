import { beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../db/migrations/migrate.js';
import { getConfig } from '../config.js';
import { initPool, getPool } from '../extensions/db.js';

beforeAll(async () => {
  const config = getConfig('testing');
  // Initialize pool for the test runner's setup operations
  initPool(config);
  
  console.log('Running migrations on test database...');
  await runMigrations(config.databaseUrl);
});

beforeEach(async () => {
  const pool = getPool();
  const config = getConfig('testing');
  
  try {
    // 1. Drop the public schema and recreate it for a completely fresh start
    // This removes all tables, types, and migrations tracking.
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    
    // 2. Run all migrations from scratch
    await runMigrations(config.databaseUrl);
  } catch (err) {
    console.error('Failed to reset public schema or run migrations:', err);
    throw err; // Stop tests if setup fails
  }
});
