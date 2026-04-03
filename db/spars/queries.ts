import type pg from "pg";
import type { SparWithMembers } from "./domain.js";

type DbClient = pg.Pool | pg.PoolClient;

export async function lazyManageSpars(pool: DbClient): Promise<void> {
  const now = new Date();

  // Release links for expired spars (time + 90 minutes)
  const { rows: expired } = await pool.query(
    `SELECT id FROM spars WHERE status IN ('ready','debating') AND time <= $1::timestamptz - INTERVAL '90 minutes'`,
    [now]
  );
  for (const { id } of expired) {
    await pool.query(`SELECT * FROM evaluate_spar_readiness($1, $2)`, [id, now]);
  }

  // Trigger evaluation for spars entering the 15-minute window
  const { rows: trigger } = await pool.query(
    `SELECT id FROM spars WHERE status IN ('created','matching') AND time <= $1::timestamptz + INTERVAL '15 minutes'`,
    [now]
  );
  for (const { id } of trigger) {
    await pool.query(`SELECT success, message FROM evaluate_spar_readiness($1, $2)`, [id, now]);
  }
}

export async function createSpar(
  pool: DbClient,
  sparData: Record<string, unknown>,
  hostData: Record<string, unknown>
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO spars (id, name, time, rule, expected_debater_level, expected_judge_level, expecting_judge, motion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [sparData.id, sparData.name, sparData.time, sparData.rule,
     sparData.expected_debater_level, sparData.expected_judge_level,
     sparData.expecting_judge ?? false, sparData.motion]
  );
  const sparId = String(rows[0].id);

  await pool.query(
    `INSERT INTO spar_members (spar_id, user_id, role, is_host, status) VALUES ($1,$2,$3,TRUE,'accepted')`,
    [sparId, hostData.user_id, hostData.role]
  );
  return sparId;
}

export async function getSparById(pool: DbClient, sparId: string): Promise<Record<string, unknown> | null> {
  await lazyManageSpars(pool);
  const { rows } = await pool.query(`SELECT * FROM spars WHERE id = $1`, [sparId]);
  return rows[0] || null;
}

async function fetchSparsWithMembers(
  pool: DbClient,
  query: string,
  params: unknown[],
  userId?: string
): Promise<SparWithMembers[]> {
  const { rows } = await pool.query(query, params);

  const sparMap = new Map<string, SparWithMembers>();

  for (const row of rows) {
    const sparId = String(row.id);
    if (!sparMap.has(sparId)) {
      const timeVal = row.time;
      const fmt = (d: Date) => {
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      sparMap.set(sparId, {
        id: sparId,
        name: row.name,
        time: timeVal instanceof Date ? fmt(timeVal) : String(timeVal),
        rule: row.rule,
        status: row.status,
        expectedDebaterLevel: row.expected_debater_level,
        expectedJudgeLevel: row.expected_judge_level,
        expectingJudge: row.expecting_judge,
        motion: row.motion,
        meetLink: null,
        prepLinks: [],
        members: [],
        isHost: null,
        notifications: null,
      });
    }

    const spar = sparMap.get(sparId)!;
    const memberUserId = row.user_id;
    if (memberUserId) {
      spar.members.push({
        userId: String(memberUserId),
        fullName: row.full_name,
        username: row.username,
        avatarURL: row.avatar_url,
        judgeLevel: row.judge_level,
        debaterLevel: row.debater_level,
        role: row.role,
        isHost: row.is_host,
        status: row.member_status,
      });

      // Show meet_link if requesting user is accepted and within time window
      if (userId && String(memberUserId) === String(userId) && row.member_status === "accepted" && row.status !== "cancelled") {
        const sTime = row.time instanceof Date ? row.time : new Date(row.time);
        const now = new Date();
        const windowStart = new Date(sTime.getTime() - 15 * 60 * 1000);
        const windowEnd = new Date(sTime.getTime() + 90 * 60 * 1000);
        if (now >= windowStart && now <= windowEnd) {
          spar.meetLink = row.meet_link;
        }
      }
    }
  }

  // Fetch prep links for visible spars
  const visibleIds = [...sparMap.entries()].filter(([, s]) => s.meetLink !== null).map(([id]) => id);
  if (visibleIds.length) {
    const { rows: prepRows } = await pool.query(
      `SELECT spar_id, meet_link, team_identifier FROM spar_prep_links WHERE spar_id = ANY($1)`,
      [visibleIds]
    );
    for (const pr of prepRows) {
      const s = sparMap.get(String(pr.spar_id));
      if (s) s.prepLinks.push({ team: pr.team_identifier, link: pr.meet_link });
    }
  }

  return [...sparMap.values()];
}

const SPAR_SELECT = `
  SELECT s.id, s.name, s.time, s.rule, s.status, s.expected_debater_level, s.expected_judge_level,
         s.expecting_judge, s.motion, s.meet_link, s.created_at,
         u.id as user_id, u.full_name, u.username, u.avatar_url, u.judge_level, u.debater_level,
         sm.role, sm.is_host, sm.status as member_status
  FROM spars s
  LEFT JOIN spar_members sm ON s.id = sm.spar_id
  LEFT JOIN users u ON sm.user_id = u.id`;

export async function getAvailableSpars(pool: DbClient, userId?: string): Promise<SparWithMembers[]> {
  await lazyManageSpars(pool);
  let query = `${SPAR_SELECT} WHERE s.status IN ('created','matching')`;
  const params: unknown[] = [];
  if (userId) {
    query += ` AND s.id NOT IN (SELECT spar_id FROM spar_members WHERE user_id = $1)`;
    params.push(userId);
  }
  query += ` ORDER BY s.time ASC`;
  return fetchSparsWithMembers(pool, query, params, userId);
}

export async function getMyActiveSpars(pool: DbClient, userId: string): Promise<SparWithMembers[]> {
  await lazyManageSpars(pool);
  const query = `${SPAR_SELECT}
    WHERE s.id IN (SELECT spar_id FROM spar_members WHERE user_id = $1 AND status IN ('pending','accepted','invited'))
      AND s.status IN ('created','matching','ready','debating')
    ORDER BY s.time ASC`;
  return fetchSparsWithMembers(pool, query, [userId], userId);
}

export async function getMyHistorySpars(pool: DbClient, userId: string): Promise<SparWithMembers[]> {
  await lazyManageSpars(pool);
  const query = `${SPAR_SELECT}
    WHERE s.id IN (SELECT spar_id FROM spar_members WHERE user_id = $1 AND status = 'accepted')
      AND s.status IN ('done','cancelled')
    ORDER BY s.time DESC`;
  return fetchSparsWithMembers(pool, query, [userId], userId);
}

export async function insertSparMember(
  pool: DbClient, sparId: string, userId: string, role: string, status: string, isHost = false
): Promise<void> {
  await pool.query(
    `INSERT INTO spar_members (spar_id, user_id, role, status, is_host) VALUES ($1,$2,$3,$4,$5)`,
    [sparId, userId, role, status, isHost]
  );
}

export async function upsertSparMember(
  pool: DbClient, sparId: string, userId: string, role: string, status: string, isHost = false
): Promise<void> {
  await pool.query(
    `INSERT INTO spar_members (spar_id, user_id, role, status, is_host) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (spar_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, is_host = EXCLUDED.is_host, created_at = NOW()`,
    [sparId, userId, role, status, isHost]
  );
}

export async function removeSparMember(pool: DbClient, sparId: string, userId: string): Promise<void> {
  await pool.query(`DELETE FROM spar_members WHERE spar_id = $1 AND user_id = $2`, [sparId, userId]);
}

export async function updateSparStatus(pool: DbClient, sparId: string, status: string): Promise<void> {
  await pool.query(`UPDATE spars SET status = $1 WHERE id = $2`, [status, sparId]);
}

export async function getSparMembers(pool: DbClient, sparId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(`SELECT * FROM spar_members WHERE spar_id = $1`, [sparId]);
  return rows;
}

export async function updateSparHost(pool: DbClient, sparId: string, userId: string, isHost: boolean): Promise<void> {
  await pool.query(`UPDATE spar_members SET is_host = $1 WHERE spar_id = $2 AND user_id = $3`, [isHost, sparId, userId]);
}
