import type pg from "pg";
import {
  Tournament, TournamentName, TournamentYear, TournamentScale, TournamentRule,
  JudgeDetails, DebaterDetails, EntryRole,
} from "./domain.js";

type DbClient = pg.Pool | pg.PoolClient;

export async function findTournament(
  pool: DbClient,
  name: TournamentName,
  year: TournamentYear,
  rule: TournamentRule
): Promise<Tournament | null> {
  const { rows } = await pool.query(
    `SELECT id, name, year, scale, rule FROM tournaments WHERE name = $1 AND year = $2 AND rule = $3`,
    [name.value, year.value, rule]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    name: new TournamentName(r.name),
    year: new TournamentYear(r.year),
    scale: new TournamentScale(r.scale),
    rule: r.rule as TournamentRule,
  };
}

export async function insertTournament(pool: DbClient, t: Tournament): Promise<void> {
  await pool.query(
    `INSERT INTO tournaments (id, name, year, scale, rule) VALUES ($1, $2, $3, $4, $5)`,
    [t.id, t.name.value, t.year.value, t.scale.value, t.rule]
  );
}

export async function insertJudgeDetails(pool: DbClient, j: JudgeDetails): Promise<void> {
  await pool.query(
    `INSERT INTO judge_details (id, rounds, highest_rank) VALUES ($1, $2, $3)`,
    [j.id, j.rounds.value, j.highestRank.value]
  );
}

export async function insertDebaterDetails(pool: DbClient, d: DebaterDetails): Promise<void> {
  await pool.query(
    `INSERT INTO debater_details (id, breaking_rank, achievement) VALUES ($1, $2, $3)`,
    [d.id, d.breakingRank.value, d.achievement.value]
  );
}

export async function insertTournamentEntry(
  pool: DbClient,
  entryId: string,
  tournamentId: string,
  userId: string,
  role: EntryRole,
  judgeDetailsId: string | null = null,
  debaterDetailsId: string | null = null
): Promise<void> {
  await pool.query(
    `INSERT INTO tournament_entries (id, tournament_id, user_id, role, judge_details_id, debater_details_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [entryId, tournamentId, userId, role, judgeDetailsId, debaterDetailsId]
  );
}

export async function getTournamentEntry(
  pool: DbClient,
  entryId: string
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    `SELECT id, tournament_id, user_id, role, judge_details_id, debater_details_id FROM tournament_entries WHERE id = $1`,
    [entryId]
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    tournament_id: rows[0].tournament_id,
    user_id: rows[0].user_id,
    role: rows[0].role,
    judge_details_id: rows[0].judge_details_id,
    debater_details_id: rows[0].debater_details_id,
  };
}

export async function updateTournamentEntryRole(
  pool: DbClient,
  entryId: string,
  role: EntryRole
): Promise<void> {
  await pool.query(
    `UPDATE tournament_entries SET role = $1 WHERE id = $2`,
    [role, entryId]
  );
}

export async function updateJudgeDetails(
  pool: DbClient,
  detailsId: string,
  rounds: number | null,
  highestRank: string | null
): Promise<void> {
  await pool.query(
    `UPDATE judge_details SET rounds = $1, highest_rank = $2 WHERE id = $3`,
    [rounds, highestRank, detailsId]
  );
}

export async function updateDebaterDetails(
  pool: DbClient,
  detailsId: string,
  breakingRank: number | null,
  achievement: string | null
): Promise<void> {
  await pool.query(
    `UPDATE debater_details SET breaking_rank = $1, achievement = $2 WHERE id = $3`,
    [breakingRank, achievement, detailsId]
  );
}

export async function updateTournamentEntryTournament(
  pool: DbClient,
  entryId: string,
  tournamentId: string
): Promise<void> {
  await pool.query(
    `UPDATE tournament_entries SET tournament_id = $1 WHERE id = $2`,
    [tournamentId, entryId]
  );
}

export async function deleteJudgeDetails(pool: DbClient, detailsId: string): Promise<void> {
  await pool.query(`DELETE FROM judge_details WHERE id = $1`, [detailsId]);
}

export async function deleteDebaterDetails(pool: DbClient, detailsId: string): Promise<void> {
  await pool.query(`DELETE FROM debater_details WHERE id = $1`, [detailsId]);
}

export async function updateTournamentEntryDetails(
  pool: DbClient,
  entryId: string,
  judgeDetailsId: string | null,
  debaterDetailsId: string | null
): Promise<void> {
  await pool.query(
    `UPDATE tournament_entries SET judge_details_id = $1, debater_details_id = $2 WHERE id = $3`,
    [judgeDetailsId, debaterDetailsId, entryId]
  );
}
