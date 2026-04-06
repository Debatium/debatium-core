import type pg from "pg";
import type { SparBallot, SparFeedback } from "./evaluation.domain.js";

type DbClient = pg.Pool | pg.PoolClient;

export async function insertBallot(
  pool: DbClient,
  sparId: string,
  judgeId: string,
  resultsJson: any,
  placementsJson: any
): Promise<void> {
  await pool.query(
    `INSERT INTO spar_ballots (spar_id, judge_id, results_json, placements_json)
     VALUES ($1, $2, $3, $4)`,
    [sparId, judgeId, JSON.stringify(resultsJson), JSON.stringify(placementsJson)]
  );
}

export async function insertFeedback(
  pool: DbClient,
  sparId: string,
  debaterId: string,
  rating: number,
  comment: string | null,
  isAnonymous: boolean
): Promise<void> {
  await pool.query(
    `INSERT INTO spar_feedbacks (spar_id, debater_id, rating, comment, is_anonymous)
     VALUES ($1, $2, $3, $4, $5)`,
    [sparId, debaterId, rating, comment, isAnonymous]
  );
}

export async function getBallotBySparId(pool: DbClient, sparId: string): Promise<SparBallot | null> {
  const { rows } = await pool.query(
    `SELECT spar_id as "sparId", judge_id as "judgeId", results_json as "resultsJson",
            placements_json as "placementsJson", created_at as "createdAt"
     FROM spar_ballots WHERE spar_id = $1`,
    [sparId]
  );
  return rows[0] || null;
}

export async function getFeedbacksBySparId(pool: DbClient, sparId: string): Promise<SparFeedback[]> {
  const { rows } = await pool.query(
    `SELECT f.spar_id as "sparId", f.debater_id as "debaterId", f.rating, f.comment,
            f.is_anonymous as "isAnonymous", f.created_at as "createdAt",
            u.username, u.avatar_url as "avatarURL"
     FROM spar_feedbacks f
     LEFT JOIN users u ON f.debater_id = u.id
     WHERE f.spar_id = $1`,
    [sparId]
  );
  return rows;
}

export async function getFeedbackByDebater(
  pool: DbClient,
  sparId: string,
  debaterId: string
): Promise<SparFeedback | null> {
  const { rows } = await pool.query(
    `SELECT spar_id as "sparId", debater_id as "debaterId", rating, comment,
            is_anonymous as "isAnonymous", created_at as "createdAt"
     FROM spar_feedbacks WHERE spar_id = $1 AND debater_id = $2`,
    [sparId, debaterId]
  );
  return rows[0] || null;
}
