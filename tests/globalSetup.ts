import { runMigrations } from '../db/migrations/migrate.js';
import { getConfig } from '../config.js';

export async function setup() {
  console.log('Global Setup: Starting migrations...');
  const config = getConfig('testing');
  await runMigrations(config.databaseUrl);
  console.log('Global Setup: Migrations completed.');
}
