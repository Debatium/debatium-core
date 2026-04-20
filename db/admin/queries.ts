import type pg from "pg";

type DbClient = pg.Pool | pg.PoolClient;

export async function getAllUsersAdmin(pool: DbClient): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT id, full_name, username, email, role, institution,
            debater_level, judge_level, debater_score, judge_score, avatar_url, joined_at
     FROM users
     ORDER BY joined_at DESC`
  );
  return rows.map((r) => ({
    id: String(r.id),
    fullName: r.full_name,
    username: r.username,
    email: r.email,
    role: r.role ?? "user",
    institution: r.institution,
    debaterLevel: r.debater_level,
    judgeLevel: r.judge_level,
    debaterScore: Number(r.debater_score),
    judgeScore: Number(r.judge_score),
    avatarURL: String(r.avatar_url),
    joinedAt: r.joined_at instanceof Date ? r.joined_at.toISOString() : r.joined_at,
  }));
}

export async function searchUsersByEmailAdmin(
  pool: DbClient,
  term: string,
  limit = 8
): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT id, full_name, username, email, avatar_url
     FROM users
     WHERE email ILIKE $1
     ORDER BY email ASC
     LIMIT $2`,
    [`${term}%`, limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    fullName: r.full_name,
    username: r.username,
    email: r.email,
    avatarURL: String(r.avatar_url),
  }));
}

export async function getUserDetailAdmin(
  pool: DbClient,
  username: string
): Promise<Record<string, unknown> | null> {
  const { rows: userRows } = await pool.query(
    `SELECT id, full_name, username, email, role, institution,
            debater_level, judge_level, debater_score, judge_score, avatar_url, joined_at
     FROM users WHERE username = $1`,
    [username]
  );
  if (!userRows[0]) return null;
  const u = userRows[0];
  const userId = String(u.id);

  const { rows: sessionRows } = await pool.query(
    `SELECT s.id, s.start_time, s.end_time, s.rule, s.status, sm.role,
            CASE
              WHEN sm.role = 'judge' THEN (
                SELECT AVG((f->>'rating')::numeric)
                FROM evaluations e, jsonb_array_elements(e.feedbacks_json) f
                WHERE e.spar_id = s.id AND e.judge_id = $1
              )
              ELSE NULL
            END AS rating_received
     FROM spar_members sm
     JOIN spars s ON s.id = sm.spar_id
     WHERE sm.user_id = $1 AND sm.status = 'accepted'
     ORDER BY s.start_time DESC`,
    [userId]
  );

  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const sessions = sessionRows.map((r) => ({
    id: String(r.id),
    startTime: r.start_time instanceof Date ? fmt(r.start_time) : String(r.start_time),
    endTime: r.end_time instanceof Date ? fmt(r.end_time) : String(r.end_time),
    rule: r.rule,
    status: r.status,
    role: r.role,
    ratingReceived: r.rating_received != null ? Number(r.rating_received) : null,
  }));

  return {
    id: userId,
    fullName: u.full_name,
    username: u.username,
    email: u.email,
    role: u.role ?? "user",
    institution: u.institution,
    debaterLevel: u.debater_level,
    judgeLevel: u.judge_level,
    debaterScore: Number(u.debater_score),
    judgeScore: Number(u.judge_score),
    avatarURL: String(u.avatar_url),
    joinedAt: u.joined_at instanceof Date ? u.joined_at.toISOString() : u.joined_at,
    totalSessions: sessions.length,
    sessions,
  };
}

export async function getAllJudgesAdmin(pool: DbClient): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.email, u.institution,
            u.judge_level, u.judge_score, u.avatar_url,
            COUNT(DISTINCT sm.spar_id) FILTER (WHERE sm.role = 'judge' AND sm.status = 'accepted') AS spars_judged,
            COUNT(DISTINCT e.spar_id) FILTER (WHERE e.status = 'submitted') AS ballots_submitted
     FROM users u
     LEFT JOIN spar_members sm ON sm.user_id = u.id
     LEFT JOIN evaluations e ON e.judge_id = u.id
     GROUP BY u.id
     HAVING COUNT(DISTINCT sm.spar_id) FILTER (WHERE sm.role = 'judge' AND sm.status = 'accepted') > 0
     ORDER BY u.username ASC`
  );
  return rows.map((r) => ({
    id: String(r.id),
    fullName: r.full_name,
    username: r.username,
    email: r.email,
    institution: r.institution,
    judgeLevel: r.judge_level,
    judgeScore: Number(r.judge_score),
    avatarURL: String(r.avatar_url),
    sparsJudged: Number(r.spars_judged),
    ballotsSubmitted: Number(r.ballots_submitted),
  }));
}

export async function getAllSparsAdmin(pool: DbClient): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.start_time, s.end_time, s.rule, s.status,
            s.expected_debater_level, s.expected_judge_level, s.expecting_judge,
            s.motion, s.created_at,
            host.id AS host_id, host.username AS host_username, host.full_name AS host_full_name,
            COUNT(sm.user_id) FILTER (WHERE sm.status = 'accepted') AS accepted_count,
            COUNT(sm.user_id) FILTER (WHERE sm.status = 'pending') AS pending_count,
            COUNT(sm.user_id) FILTER (WHERE sm.status = 'invited') AS invited_count,
            COUNT(sm.user_id) FILTER (WHERE sm.role = 'debater' AND sm.status = 'accepted') AS accepted_debaters,
            COUNT(sm.user_id) FILTER (WHERE sm.role = 'judge' AND sm.status = 'accepted') AS accepted_judges
     FROM spars s
     LEFT JOIN spar_members sm ON sm.spar_id = s.id
     LEFT JOIN spar_members host_sm ON host_sm.spar_id = s.id AND host_sm.is_host = TRUE
     LEFT JOIN users host ON host.id = host_sm.user_id
     GROUP BY s.id, host.id, host.username, host.full_name
     ORDER BY s.created_at DESC`
  );

  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    startTime: r.start_time instanceof Date ? fmt(r.start_time) : String(r.start_time),
    endTime: r.end_time instanceof Date ? fmt(r.end_time) : String(r.end_time),
    rule: r.rule,
    status: r.status,
    expectedDebaterLevel: r.expected_debater_level,
    expectedJudgeLevel: r.expected_judge_level,
    expectingJudge: r.expecting_judge,
    motion: r.motion,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    host: r.host_id
      ? {
          id: String(r.host_id),
          username: r.host_username,
          fullName: r.host_full_name,
        }
      : null,
    counts: {
      accepted: Number(r.accepted_count),
      pending: Number(r.pending_count),
      invited: Number(r.invited_count),
      acceptedDebaters: Number(r.accepted_debaters),
      acceptedJudges: Number(r.accepted_judges),
    },
  }));
}
