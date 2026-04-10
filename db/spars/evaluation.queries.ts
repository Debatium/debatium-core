import type pg from "pg";
import type { Evaluation, FeedbackEntry } from "./evaluation.domain.js";

type DbClient = pg.Pool | pg.PoolClient;

export async function ensureEvaluation(
  pool: DbClient,
  sparId: string,
  judgeId: string
): Promise<Evaluation> {
  const { rows } = await pool.query(
    `INSERT INTO evaluations (spar_id, judge_id)
     VALUES ($1, $2)
     ON CONFLICT (spar_id, judge_id) DO NOTHING
     RETURNING spar_id AS "sparId", judge_id AS "judgeId", status,
               results_json AS "resultsJson", placements_json AS "placementsJson",
               feedbacks_json AS "feedbacksJson", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [sparId, judgeId]
  );
  if (rows[0]) return rows[0];
  return (await getEvaluationBySparId(pool, sparId))!;
}

export async function getEvaluationBySparId(pool: DbClient, sparId: string): Promise<Evaluation | null> {
  const { rows } = await pool.query(
    `SELECT spar_id AS "sparId", judge_id AS "judgeId", status,
            results_json AS "resultsJson", placements_json AS "placementsJson",
            feedbacks_json AS "feedbacksJson", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM evaluations WHERE spar_id = $1`,
    [sparId]
  );
  return rows[0] || null;
}

export async function submitBallot(
  pool: DbClient,
  sparId: string,
  resultsJson: any,
  placementsJson: any
): Promise<void> {
  await pool.query(
    `UPDATE evaluations
     SET results_json = $2, placements_json = $3, status = 'submitted', updated_at = NOW()
     WHERE spar_id = $1`,
    [sparId, JSON.stringify(resultsJson), JSON.stringify(placementsJson)]
  );
}

export async function appendFeedback(
  pool: DbClient,
  sparId: string,
  feedback: FeedbackEntry
): Promise<void> {
  await pool.query(
    `UPDATE evaluations
     SET feedbacks_json = feedbacks_json || $2::jsonb, updated_at = NOW()
     WHERE spar_id = $1`,
    [sparId, JSON.stringify(feedback)]
  );
}
