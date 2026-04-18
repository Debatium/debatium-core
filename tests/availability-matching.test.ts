import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const dbUrl = process.env.DATABASE_URL || "postgresql://user:password@localhost:5440/dev_db";
const pool = new pg.Pool({ connectionString: dbUrl });

after(async () => {
  await pool.end();
});

type DbClient = pg.PoolClient;

type DebaterLevel = "novice" | "open" | "pro";
type JudgeLevel = "novice" | "intermediate" | "advanced" | "expert";
type SparStatus = "created" | "matching";
type SparRole = "debater" | "judge" | "observer";

type UserSeed = {
  debaterLevel?: DebaterLevel;
  judgeLevel?: JudgeLevel;
};

type SparSeed = {
  name: string;
  time: Date;
  rule: "bp" | "wsdc";
  status: SparStatus;
  expectedDebaterLevel: DebaterLevel;
  expectingJudge?: boolean;
  expectedJudgeLevel?: JudgeLevel | null;
};

type AvailabilitySeed = {
  userId: string;
  name: string;
  startTime: Date;
  endTime: Date;
  format: "bp" | "wsdc";
  roles: string[];
  createdAt?: Date;
  updatedAt?: Date;
};

async function withRollback(fn: (client: DbClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

async function ensureV10Installed(client: DbClient): Promise<void> {
  const { rowCount } = await client.query(
    "SELECT 1 FROM pg_proc WHERE proname = 'match_for_new_spar' LIMIT 1"
  );
  assert.equal(rowCount, 1, "match_for_new_spar is missing. Run migrations before tests.");
}

async function insertUser(client: DbClient, seed: UserSeed = {}): Promise<string> {
  const id = randomUUID();
  const token = id.replace(/-/g, "").slice(0, 12);

  await client.query(
    `
      INSERT INTO users (
        id,
        full_name,
        username,
        password,
        email,
        debater_level,
        judge_level
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      id,
      `Test User ${token}`,
      `test_user_${token}`,
      "not-used-in-db-matching-test",
      `test_${token}@example.com`,
      seed.debaterLevel ?? "open",
      seed.judgeLevel ?? "intermediate",
    ]
  );

  return id;
}

async function insertSpar(client: DbClient, seed: SparSeed): Promise<string> {
  const id = randomUUID();

  await client.query(
    `
      INSERT INTO spars (
        id,
        name,
        time,
        rule,
        status,
        expected_debater_level,
        expected_judge_level,
        expecting_judge,
        motion
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      id,
      seed.name,
      seed.time,
      seed.rule,
      seed.status,
      seed.expectedDebaterLevel,
      seed.expectedJudgeLevel ?? null,
      seed.expectingJudge ?? false,
      "Motion for matching test",
    ]
  );

  return id;
}

async function insertMember(
  client: DbClient,
  sparId: string,
  userId: string,
  role: SparRole,
  status: "accepted" | "invited",
  isHost = false
): Promise<void> {
  await client.query(
    `
      INSERT INTO spar_members (spar_id, user_id, role, status, is_host)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [sparId, userId, role, status, isHost]
  );
}

async function insertAvailability(client: DbClient, seed: AvailabilitySeed): Promise<string> {
  const id = randomUUID();
  const createdAt = seed.createdAt ?? new Date();
  const updatedAt = seed.updatedAt ?? createdAt;

  await client.query(
    `
      INSERT INTO user_availabilities (
        id,
        user_id,
        name,
        start_time,
        end_time,
        format,
        roles,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
    `,
    [
      id,
      seed.userId,
      seed.name,
      seed.startTime,
      seed.endTime,
      seed.format,
      JSON.stringify(seed.roles),
      createdAt,
      updatedAt,
    ]
  );

  return id;
}

async function insertAcceptedDebaters(
  client: DbClient,
  sparId: string,
  count: number,
  level: DebaterLevel
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const userId = await insertUser(client, { debaterLevel: level });
    await insertMember(client, sparId, userId, "debater", "accepted", false);
  }
}

test(
  "match_for_new_spar prioritizes oldest availability before level fit and emits notification",
  { concurrency: false },
  async () => {
    await withRollback(async (client) => {
      await ensureV10Installed(client);

      const now = new Date();
      const sparTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const availabilityStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const availabilityEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      const hostId = await insertUser(client, { debaterLevel: "open" });
      const olderCandidateId = await insertUser(client, { debaterLevel: "novice" });
      const newerBetterLevelCandidateId = await insertUser(client, { debaterLevel: "open" });

      await insertAvailability(client, {
        userId: olderCandidateId,
        name: "older-availability",
        startTime: availabilityStart,
        endTime: availabilityEnd,
        format: "wsdc",
        roles: ["debater"],
        createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      });

      await insertAvailability(client, {
        userId: newerBetterLevelCandidateId,
        name: "newer-availability",
        startTime: availabilityStart,
        endTime: availabilityEnd,
        format: "wsdc",
        roles: ["debater"],
        createdAt: new Date(now.getTime() - 90 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 60 * 60 * 1000),
      });

      const sparId = await insertSpar(client, {
        name: `match-new-spar-${randomUUID()}`,
        time: sparTime,
        rule: "wsdc",
        status: "created",
        expectedDebaterLevel: "open",
      });

      await insertMember(client, sparId, hostId, "debater", "accepted", true);
      await insertAcceptedDebaters(client, sparId, 4, "open");

      await client.query(`SELECT match_for_new_spar($1)`, [sparId]);

      const invitedRows = await client.query<{ user_id: string }>(
        `
          SELECT user_id
          FROM spar_members
          WHERE spar_id = $1 AND role = 'debater' AND status = 'invited'
          ORDER BY created_at ASC, user_id ASC
        `,
        [sparId]
      );
      assert.equal(invitedRows.rowCount, 1, "Expected exactly one debater invite");
      assert.equal(
        invitedRows.rows[0]?.user_id,
        olderCandidateId,
        "Oldest availability should be invited before better level-fit candidate"
      );

      const notificationRows = await client.query<{ source: string | null }>(
        `
          SELECT payload->>'source' AS source
          FROM notifications
          WHERE customer_id = $1
            AND reference_id = $2
            AND event_type = 'INVITE_RECEIVED'
            AND channel = 'in-app'
        `,
        [olderCandidateId, sparId]
      );

      assert.equal(notificationRows.rowCount, 1, "Expected one invite notification for auto-match");
      assert.equal(notificationRows.rows[0]?.source, "auto_matching");
    });
  }
);

test(
  "availability update prioritizes near-full spar before better level fit and emits notification",
  { concurrency: false },
  async () => {
    await withRollback(async (client) => {
      await ensureV10Installed(client);

      const now = new Date();
      const sparTime = new Date(now.getTime() + 10 * 60 * 60 * 1000);
      const availabilityStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const availabilityEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      const candidateId = await insertUser(client, { debaterLevel: "open" });

      const sparANearFull = await insertSpar(client, {
        name: `near-full-${randomUUID()}`,
        time: sparTime,
        rule: "wsdc",
        status: "created",
        expectedDebaterLevel: "novice",
      });
      const sparBBetterLevel = await insertSpar(client, {
        name: `better-level-${randomUUID()}`,
        time: sparTime,
        rule: "wsdc",
        status: "created",
        expectedDebaterLevel: "open",
      });

      const hostA = await insertUser(client, { debaterLevel: "open" });
      await insertMember(client, sparANearFull, hostA, "debater", "accepted", true);
      await insertAcceptedDebaters(client, sparANearFull, 4, "open");

      const hostB = await insertUser(client, { debaterLevel: "open" });
      await insertMember(client, sparBBetterLevel, hostB, "debater", "accepted", true);
      await insertAcceptedDebaters(client, sparBBetterLevel, 3, "open");

      const availabilityId = await insertAvailability(client, {
        userId: candidateId,
        name: "availability-before-update",
        startTime: availabilityStart,
        endTime: availabilityEnd,
        format: "wsdc",
        roles: ["observer"],
      });

      await client.query(
        `
          UPDATE user_availabilities
          SET roles = $2::jsonb,
              name = $3
          WHERE id = $1
        `,
        [availabilityId, JSON.stringify(["debater"]), "availability-after-update"]
      );

      const inviteRows = await client.query<{ spar_id: string }>(
        `
          SELECT spar_id
          FROM spar_members
          WHERE user_id = $1 AND role = 'debater' AND status = 'invited'
          ORDER BY created_at ASC, spar_id ASC
        `,
        [candidateId]
      );
      assert.equal(inviteRows.rowCount, 1, "Expected one invite after availability update");
      assert.equal(
        inviteRows.rows[0]?.spar_id,
        sparANearFull,
        "Availability update should prefer near-full spar before level-fit spar"
      );

      const notificationRows = await client.query<{ reference_id: string }>(
        `
          SELECT reference_id
          FROM notifications
          WHERE customer_id = $1
            AND event_type = 'INVITE_RECEIVED'
            AND channel = 'in-app'
          ORDER BY created_at ASC
        `,
        [candidateId]
      );

      assert.equal(notificationRows.rowCount, 1, "Expected one notification for update-driven invite");
      assert.equal(notificationRows.rows[0]?.reference_id, sparANearFull);
    });
  }
);
