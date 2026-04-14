import type pg from "pg";
import type { User, UserAvailability } from "./domain.js";

type DbClient = pg.Pool | pg.PoolClient;

export async function insertUser(pool: DbClient, user: User): Promise<void> {
  await pool.query(
    `INSERT INTO users (
      id, full_name, username, password, email,
      debater_level, judge_level, debater_score, judge_score,
      institution, avatar_url, calendar_key
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      user.id,
      user.fullName.value,
      user.username.value,
      user.passwordHash,
      user.email.value,
      user.debaterLevel,
      user.judgeLevel,
      user.debaterScore,
      user.judgeScore,
      user.institution?.value ?? null,
      user.avatarUrl.value,
      user.calendarKey,
    ]
  );
}

export async function getUserByEmail(
  pool: DbClient,
  email: string
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT id, full_name, username, password, email,
            debater_level, judge_level, debater_score, judge_score, institution, avatar_url
     FROM users WHERE email = $1`,
    [email]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    fullName: r.full_name,
    username: r.username,
    passwordHash: r.password,
    email: r.email,
    debaterLevel: r.debater_level,
    judgeLevel: r.judge_level,
    debaterScore: Number(r.debater_score),
    judgeScore: Number(r.judge_score),
    institution: r.institution,
    avatarURL: String(r.avatar_url),
  };
}

export async function getUserById(
  pool: DbClient,
  userId: string
): Promise<{ id: string; fullName: string; username: string; email: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, full_name, username, email FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) return null;
  return {
    id: String(rows[0].id),
    fullName: rows[0].full_name,
    username: rows[0].username,
    email: rows[0].email,
  };
}

export async function getUserByUsername(
  pool: DbClient,
  username: string
): Promise<{ id: string; fullName: string; username: string; email: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, full_name, username, email FROM users WHERE username = $1`,
    [username]
  );
  if (!rows[0]) return null;
  return {
    id: String(rows[0].id),
    fullName: rows[0].full_name,
    username: rows[0].username,
    email: rows[0].email,
  };
}

export async function getUserPasswordHash(
  pool: DbClient,
  userId: string
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT password FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0]?.password ?? null;
}

export async function updateUser(
  pool: DbClient,
  userId: string,
  data: Record<string, unknown>
): Promise<void> {
  const mapping: Record<string, string> = {
    fullName: "full_name",
    username: "username",
    email: "email",
    institution: "institution",
    passwordHash: "password",
    avatarURL: "avatar_url",
  };

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, col] of Object.entries(mapping)) {
    if (key in data) {
      fields.push(`${col} = $${idx++}`);
      values.push(data[key]);
    }
  }

  if (!fields.length) return;

  values.push(userId);
  await pool.query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}

export async function getUserProfileData(
  pool: DbClient,
  userId: string
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT full_name, username, institution, debater_level, judge_level, email, avatar_url
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) return null;
  const r = rows[0];

  const profile: Record<string, unknown> = {
    fullName: r.full_name,
    username: r.username,
    institution: r.institution,
    debaterLevel: r.debater_level,
    judgeLevel: r.judge_level,
    email: r.email,
    avatarURL: String(r.avatar_url),
    tournamentEntries: [] as Record<string, unknown>[],
  };

  const { rows: entries } = await pool.query(
    `SELECT t.name, t.year, t.scale, t.rule, te.role,
            dd.breaking_rank, dd.achievement,
            jd.rounds, jd.highest_rank,
            te.id
     FROM tournament_entries te
     JOIN tournaments t ON te.tournament_id = t.id
     LEFT JOIN debater_details dd ON te.debater_details_id = dd.id
     LEFT JOIN judge_details jd ON te.judge_details_id = jd.id
     WHERE te.user_id = $1`,
    [userId]
  );

  const tournamentEntries: Record<string, unknown>[] = [];
  for (const row of entries) {
    const entry: Record<string, unknown> = {
      name: row.name?.trim() ?? null,
      year: row.year != null ? String(row.year) : null,
      scale: row.scale != null ? String(row.scale) : null,
      rule: row.rule,
      role: row.role,
    };

    if (row.breaking_rank != null || row.achievement != null) {
      const debaterDetails: Record<string, string> = {};
      if (row.breaking_rank != null) debaterDetails.breakingRank = String(row.breaking_rank);
      if (row.achievement != null) debaterDetails.achievement = row.achievement;
      entry.debaterDetails = debaterDetails;
    }

    if (row.rounds != null || row.highest_rank != null) {
      const judgeDetails: Record<string, string> = {};
      if (row.rounds != null) judgeDetails.rounds = String(row.rounds);
      if (row.highest_rank != null) judgeDetails.highestRank = row.highest_rank;
      entry.judgeDetails = judgeDetails;
    }

    entry.id = String(row.id);
    tournamentEntries.push(entry);
  }

  profile.tournamentEntries = tournamentEntries;
  return profile;
}

export async function getPublicProfileData(
  pool: DbClient,
  username: string
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT username, full_name AS "fullName", institution, debater_level, judge_level
     FROM users WHERE username = $1`,
    [username]
  );
  if (!rows[0]) return null;
  return rows[0];
}

export async function searchUsersData(
  pool: DbClient,
  term: string
): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT id AS "userId", username, full_name AS "fullName", avatar_url AS "avatarURL"
     FROM users WHERE username ILIKE $1 OR full_name ILIKE $1 LIMIT 20`,
    [`${term}%`]
  );
  return rows.map((r) => ({
    userId: String(r.userId),
    username: r.username,
    fullName: r.fullName,
    avatarURL: r.avatarURL != null ? String(r.avatarURL) : null,
  }));
}

// ── Availability queries ──

export async function getUserCalendarData(
  pool: DbClient,
  userId: string
): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT id, name, start_time, end_time, format, expected_judge_level, expected_debater_level, roles
     FROM user_availabilities WHERE user_id = $1`,
    [userId]
  );
  return rows.map((r) => {
    const fmt = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    return {
      id: String(r.id),
      name: r.name,
      startDate: fmt(r.start_time),
      endDate: fmt(r.end_time),
      format: r.format,
      expectedJudgeLevel: r.expected_judge_level,
      expectedDebaterLevel: r.expected_debater_level,
      roles: r.roles,
    };
  });
}

export async function insertUserAvailability(
  pool: DbClient,
  a: UserAvailability
): Promise<void> {
  await pool.query(
    `INSERT INTO user_availabilities (
      id, user_id, name, start_time, end_time, format,
      expected_judge_level, expected_debater_level, roles
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      a.id,
      a.userId,
      a.name,
      a.startTime.value,
      a.endTime.value,
      a.format,
      a.expectedJudgeLevel ?? null,
      a.expectedDebaterLevel ?? null,
      JSON.stringify(a.roles.map((r) => r.value)),
    ]
  );
}

export async function getUserAvailability(
  pool: DbClient,
  availabilityId: string,
  userId: string
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT id, name, start_time, end_time, format, expected_judge_level, expected_debater_level, roles
     FROM user_availabilities WHERE id = $1 AND user_id = $2`,
    [availabilityId, userId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    name: r.name,
    start_time: r.start_time,
    end_time: r.end_time,
    format: r.format,
    expected_judge_level: r.expected_judge_level,
    expected_debater_level: r.expected_debater_level,
    roles: r.roles,
  };
}

export async function updateUserAvailability(
  pool: DbClient,
  a: UserAvailability
): Promise<void> {
  await pool.query(
    `UPDATE user_availabilities
     SET name = $1, start_time = $2, end_time = $3, format = $4,
         expected_judge_level = $5, expected_debater_level = $6, roles = $7
     WHERE id = $8 AND user_id = $9`,
    [
      a.name,
      a.startTime.value,
      a.endTime.value,
      a.format,
      a.expectedJudgeLevel ?? null,
      a.expectedDebaterLevel ?? null,
      JSON.stringify(a.roles.map((r) => r.value)),
      a.id,
      a.userId,
    ]
  );
}

export async function deleteUserAvailability(
  pool: DbClient,
  availabilityId: string,
  userId: string
): Promise<void> {
  await pool.query(
    `DELETE FROM user_availabilities WHERE id = $1 AND user_id = $2`,
    [availabilityId, userId]
  );
}

export async function updateUserCalendarKey(
  pool: DbClient,
  userId: string,
  calendarKey: string
): Promise<void> {
  await pool.query(
    `UPDATE users SET calendar_key = $1 WHERE id = $2`,
    [calendarKey, userId]
  );
}

// ── Wallet / Coin queries ──

export async function getUserBalances(pool: DbClient, userId: string): Promise<{ availableBalance: number, frozenBalance: number } | null> {
  const { rows } = await pool.query(
    `SELECT available_balance, frozen_balance FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) return null;
  return {
    availableBalance: Number(rows[0].available_balance),
    frozenBalance: Number(rows[0].frozen_balance)
  };
}

export async function recordTopUpSuccess(pool: DbClient, userId: string, amount: number): Promise<void> {
  await pool.query(
    `UPDATE users SET available_balance = available_balance + $1 WHERE id = $2`,
    [amount, userId]
  );
}

export async function freezeBalance(pool: DbClient, userId: string, amount: number): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE users
     SET available_balance = available_balance - $1,
         frozen_balance = frozen_balance + $1
     WHERE id = $2 AND available_balance >= $1`,
    [amount, userId]
  );
  if (rowCount === 0) {
    throw new Error("Insufficient available balance to freeze: " + amount);
  }
}

export async function releaseBalance(pool: DbClient, fromUserId: string, toUserId: string, amount: number, platformCutPercent: number): Promise<void> {
  // Deduct frozen from fromUserId
  const { rowCount } = await pool.query(
    `UPDATE users SET frozen_balance = frozen_balance - $1 WHERE id = $2 AND frozen_balance >= $1`,
    [amount, fromUserId]
  );
  if (rowCount === 0) {
    throw new Error("Insufficient frozen balance to release");
  }
  
  // Add available to toUserId (minus platform cut)
  const toAdd = Math.floor(amount * (1 - platformCutPercent / 100));
  await pool.query(
    `UPDATE users SET available_balance = available_balance + $1 WHERE id = $2`,
    [toAdd, toUserId]
  );
}

export async function refundBalance(pool: DbClient, userId: string, amount: number): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE users
     SET frozen_balance = frozen_balance - $1,
         available_balance = available_balance + $1
     WHERE id = $2 AND frozen_balance >= $1`,
    [amount, userId]
  );
  if (rowCount === 0) {
    throw new Error("Insufficient frozen balance to refund");
  }
}
