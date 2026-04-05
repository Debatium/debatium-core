import pg from "pg";
import fs from "fs";
import path from "path";
import argon2 from "argon2";
import dotenv from "dotenv";

dotenv.config();

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://user:password@localhost:5440/dev_db";

const TEST_PASSWORD = "TestPassword123@";

async function runMigrations() {
  const migrationsDir = __dirname;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && !f.endsWith("_down.sql"))
    .sort();

  console.log(`Connecting to: ${DB_URL.replace(/:[^@]+@/, ":***@")}`);

  const pool = new pg.Pool({ connectionString: DB_URL });
  const client = await pool.connect();

  try {
    // Create migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get already-applied migrations
    const { rows } = await client.query(
      "SELECT version FROM schema_migrations"
    );
    const applied = new Set(rows.map((r) => r.version));

    // Auto-detect already-applied migrations by checking if key tables exist
    if (!applied.has("V1")) {
      const tableCheck = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      `);
      if (tableCheck.rows.length > 0) {
        const existingVersions = ["V1", "V2", "V3", "V4", "V5", "V6"];
        for (const v of existingVersions) {
          if (!applied.has(v)) {
            await client.query(
              "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
              [v]
            );
            applied.add(v);
            console.log(`  ${v} already exists in DB, registered as applied.`);
          }
        }
      }
    }

    // Hash the test password once for seed data
    const hashedPassword = await argon2.hash(TEST_PASSWORD);

    for (const file of files) {
      const version = file.split("__")[0];
      if (applied.has(version)) {
        console.log(`  ${version} already applied, skipping.`);
        continue;
      }

      console.log(`Applying ${file}...`);
      let sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

      // Replace password placeholder in seed migration
      if (sql.includes("__HASHED_PASSWORD__")) {
        sql = sql.replaceAll("__HASHED_PASSWORD__", hashedPassword);
      }

      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version]
      );
      console.log(`  ${version} OK`);
    }

    console.log("\nAll migrations applied successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
