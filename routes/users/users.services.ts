import crypto from "crypto";
import { v6 as uuidv6 } from "uuid";
import argon2 from "argon2";
import { getPool } from "../../extensions/db.js";
import { DomainValidationError } from "../../db/exceptions.js";
import {
  FullName, Username, Email, Institution, Password, AvatarURL,
  DebaterLevel, JudgeLevel, CustomDateTime, AvailabilityRole,
  validateAvailability,
  type UserAvailability,
  type AvailabilitySlot,
} from "../../db/users/domain.js";
import {
  TournamentName, TournamentYear, TournamentScale, TournamentRule,
  JudgeRounds, JudgeHighestRank, BreakingRank, Achievement, EntryRole,
  type JudgeDetails, type DebaterDetails,
} from "../../db/tournaments/domain.js";
import {
  getUserPasswordHash, updateUser,
  insertUserAvailability, getUserCalendarData,
  getUserAvailability, updateUserAvailability, deleteUserAvailability,
  updateUserCalendarKey,
} from "../../db/users/queries.js";
import {
  findTournament, insertTournament, insertJudgeDetails, insertDebaterDetails,
  insertTournamentEntry, getTournamentEntry, updateTournamentEntryRole,
  updateJudgeDetails, updateDebaterDetails, updateTournamentEntryTournament,
  deleteJudgeDetails, deleteDebaterDetails, updateTournamentEntryDetails,
} from "../../db/tournaments/queries.js";

// ── Helpers ──

async function hashPassword(raw: string): Promise<string> {
  return argon2.hash(raw);
}

async function processTournamentEntries(
  pool: import("pg").Pool | import("pg").PoolClient,
  userId: string,
  entries: Record<string, unknown>[]
): Promise<void> {
  for (const entry of entries) {
    const tName = new TournamentName(entry.name as string);
    const tYear = new TournamentYear(Number(entry.year));
    const tScale = new TournamentScale(Number(entry.scale));
    const tRule = entry.rule as TournamentRule;
    if (!Object.values(TournamentRule).includes(tRule)) {
      throw new DomainValidationError(`Invalid tournament rule: ${tRule}`);
    }

    let tournament = await findTournament(pool, tName, tYear, tRule);
    if (!tournament) {
      tournament = { id: uuidv6(), name: tName, year: tYear, scale: tScale, rule: tRule };
      await insertTournament(pool, tournament);
    }

    const role = entry.role as EntryRole;
    if (!Object.values(EntryRole).includes(role)) {
      throw new DomainValidationError(`Invalid entry role: ${role}`);
    }

    let judgeId: string | null = null;
    let debaterId: string | null = null;

    if (role === EntryRole.DEBATER) {
      if (entry.judgeDetails) throw new DomainValidationError("Debaters cannot have judgeDetails");
      if (!entry.debaterDetails) throw new DomainValidationError("Debaters must have debaterDetails");

      const dd = entry.debaterDetails as Record<string, unknown>;
      if (!("breakingRank" in dd)) throw new DomainValidationError("debaterDetails missing required key: breakingRank");
      if (!("achievement" in dd)) throw new DomainValidationError("debaterDetails missing required key: achievement");

      const brRaw = dd.breakingRank;
      const brVal = brRaw != null && brRaw !== "" ? Number(brRaw) : null;
      const achieveVal = (dd.achievement as string) || null;

      const debaterDetails: DebaterDetails = {
        id: uuidv6(),
        breakingRank: new BreakingRank(brVal),
        achievement: new Achievement(achieveVal),
      };
      await insertDebaterDetails(pool, debaterDetails);
      debaterId = debaterDetails.id;
    } else {
      if (entry.debaterDetails) throw new DomainValidationError("Adjudicators cannot have debaterDetails");
      if (!entry.judgeDetails) throw new DomainValidationError("Adjudicators must have judgeDetails");

      const jd = entry.judgeDetails as Record<string, unknown>;
      if (!("rounds" in jd)) throw new DomainValidationError("judgeDetails missing required key: rounds");
      if (!("highestRank" in jd)) throw new DomainValidationError("judgeDetails missing required key: highestRank");

      const judgeDetails: JudgeDetails = {
        id: uuidv6(),
        rounds: new JudgeRounds(Number(jd.rounds)),
        highestRank: new JudgeHighestRank(jd.highestRank as string),
      };
      await insertJudgeDetails(pool, judgeDetails);
      judgeId = judgeDetails.id;
    }

    await insertTournamentEntry(pool, uuidv6(), tournament.id, userId, role, judgeId, debaterId);
  }
}

// ── Services ──

export async function updateUserService(
  userId: string,
  data: Record<string, unknown>
): Promise<void> {
  const changeFields = ["fullName", "username", "email", "institution", "password", "avatarURL", "tournamentEntries"];
  const changes = changeFields.filter((f) => f in data);
  if (!changes.length) throw new DomainValidationError("No valid field provided for update.");

  const updateData: Record<string, unknown> = {};
  const pool = getPool();

  // 1. Pre-verification for password/email changes
  if ("password" in data || "email" in data) {
    if (!("currentPassword" in data)) {
      const msg = "password" in data
        ? "Current password is required to change password"
        : "Current password is required to change email";
      throw new DomainValidationError(msg);
    }

    const currentHash = await getUserPasswordHash(pool, userId);
    if (!currentHash) throw new DomainValidationError("User not found");

    const valid = await argon2.verify(currentHash, data.currentPassword as string);
    if (!valid) {
      throw new DomainValidationError("password" in data ? "Incorrect current password" : "Incorrect password");
    }
  }

  // 2. Process profile changes
  if ("fullName" in data) updateData.fullName = new FullName(data.fullName as string).value;
  if ("username" in data) updateData.username = new Username(data.username as string).value;
  if ("institution" in data) updateData.institution = new Institution(data.institution as string | null).value;
  if ("password" in data) updateData.passwordHash = await hashPassword(new Password(data.password as string).value);
  if ("email" in data) updateData.email = new Email(data.email as string).value;
  if ("avatarURL" in data) updateData.avatarURL = new AvatarURL(Number(data.avatarURL)).value;

  // 3. Execute update transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (Object.keys(updateData).length) {
      await updateUser(client, userId, updateData);
    }

    // 4. Handle tournament entries (granular)
    if ("tournamentEntries" in data) {
      let entries = data.tournamentEntries as Record<string, unknown>[];
      if (!Array.isArray(entries)) entries = [entries];

      for (const entry of entries) {
        if ("id" in entry) {
          await updateExistingTournamentEntry(client, userId, entry);
        } else {
          await processTournamentEntries(client, userId, [entry]);
        }
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function updateExistingTournamentEntry(
  pool: import("pg").Pool | import("pg").PoolClient,
  userId: string,
  entryData: Record<string, unknown>
): Promise<void> {
  const entryId = entryData.id as string;
  const existing = await getTournamentEntry(pool, entryId);
  if (!existing || String(existing.user_id).trim().toLowerCase() !== String(userId).trim().toLowerCase()) {
    throw new DomainValidationError("Tournament entry not found or unauthorized");
  }

  // Update tournament if identifying fields provided
  if (["name", "year", "rule"].some((k) => k in entryData)) {
    const { rows: tRows } = await pool.query(
      `SELECT name, year, rule FROM tournaments WHERE id = $1`,
      [existing.tournament_id]
    );
    const tRow = tRows[0];

    const tName = new TournamentName((entryData.name as string) ?? tRow.name?.trim());
    const tYear = new TournamentYear(Number(entryData.year ?? tRow.year));
    const tRule = (entryData.rule as TournamentRule) ?? tRow.rule;

    let tournament = await findTournament(pool, tName, tYear, tRule);
    if (!tournament) {
      const { rows: scaleRows } = await pool.query(
        `SELECT scale FROM tournaments WHERE id = $1`,
        [existing.tournament_id]
      );
      const existingScale = scaleRows[0].scale;
      const tScale = new TournamentScale(Number(entryData.scale ?? existingScale));
      tournament = { id: uuidv6(), name: tName, year: tYear, scale: tScale, rule: tRule };
      await insertTournament(pool, tournament);
    }

    if (String(tournament.id) !== String(existing.tournament_id)) {
      await updateTournamentEntryTournament(pool, entryId, tournament.id);
    }
  }

  // Update role if provided
  if ("role" in entryData) {
    await updateTournamentEntryRole(pool, entryId, entryData.role as EntryRole);
  }

  // Update details & handle role transition
  if (entryData.judgeDetails) {
    const jd = entryData.judgeDetails as Record<string, unknown>;
    if (existing.judge_details_id) {
      await updateJudgeDetails(
        pool,
        existing.judge_details_id as string,
        "rounds" in jd ? Number(jd.rounds) : null,
        "highestRank" in jd ? (jd.highestRank as string) : null
      );
    } else {
      const newJd: JudgeDetails = {
        id: uuidv6(),
        rounds: new JudgeRounds(Number(jd.rounds)),
        highestRank: new JudgeHighestRank(jd.highestRank as string),
      };
      await insertJudgeDetails(pool, newJd);
      const oldDebaterId = existing.debater_details_id as string;
      await updateTournamentEntryDetails(pool, entryId, newJd.id, null);
      await deleteDebaterDetails(pool, oldDebaterId);
    }
  } else if (entryData.debaterDetails) {
    const dd = entryData.debaterDetails as Record<string, unknown>;
    if (existing.debater_details_id) {
      await updateDebaterDetails(
        pool,
        existing.debater_details_id as string,
        dd.breakingRank != null ? Number(dd.breakingRank) : null,
        (dd.achievement as string) ?? null
      );
    } else {
      const brRaw = dd.breakingRank;
      const brVal = brRaw != null && brRaw !== "" ? Number(brRaw) : null;
      const achieveVal = (dd.achievement as string) || null;
      const newDd: DebaterDetails = {
        id: uuidv6(),
        breakingRank: new BreakingRank(brVal),
        achievement: new Achievement(achieveVal),
      };
      await insertDebaterDetails(pool, newDd);
      const oldJudgeId = existing.judge_details_id as string;
      await updateTournamentEntryDetails(pool, entryId, null, newDd.id);
      await deleteJudgeDetails(pool, oldJudgeId);
    }
  }
}

export async function getUserCalendarService(userId: string): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  return getUserCalendarData(pool, userId);
}

function parseSlotPairs(raw: unknown): AvailabilitySlot[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DomainValidationError("'slots' must be a non-empty array");
  }
  return raw.map((pair) => {
    const p = pair as { startDate?: unknown; endDate?: unknown };
    const start = CustomDateTime.fromStr(typeof p.startDate === "string" ? p.startDate : "");
    const end = CustomDateTime.fromStr(typeof p.endDate === "string" ? p.endDate : "");
    return { start, end };
  });
}

function parseAvailabilityCommonFields(data: Record<string, unknown>): {
  format: TournamentRule;
  roles: AvailabilityRole[];
  judgeLevel: JudgeLevel | null;
  debaterLevel: DebaterLevel | null;
} {
  const formatStr = (data.format as string) ?? "";
  if (!Object.values(TournamentRule).includes(formatStr as TournamentRule)) {
    throw new DomainValidationError(`Invalid format: ${formatStr}`);
  }
  const rolesList = (data.roles as string[]) ?? [];
  const roles = rolesList.map((r) => new AvailabilityRole(r));
  const judgeLevelVal = data.expectedJudgeLevel as string | undefined;
  const debaterLevelVal = data.expectedDebaterLevel as string | undefined;
  return {
    format: formatStr as TournamentRule,
    roles,
    judgeLevel: judgeLevelVal ? (judgeLevelVal as JudgeLevel) : null,
    debaterLevel: debaterLevelVal ? (debaterLevelVal as DebaterLevel) : null,
  };
}

function buildAvailability(
  id: string,
  userId: string,
  slots: AvailabilitySlot[],
  format: TournamentRule,
  roles: AvailabilityRole[],
  judgeLevel: JudgeLevel | null,
  debaterLevel: DebaterLevel | null,
  existingName?: string
): UserAvailability {
  const rolesStr = roles.map((r) => r.value).join("_");
  const randInt = Math.floor(Math.random() * 9000) + 1000;
  const name = existingName ?? `${format}_${rolesStr}_${randInt}`;
  const availability: UserAvailability = {
    id,
    userId,
    name,
    slots,
    format,
    expectedJudgeLevel: judgeLevel,
    expectedDebaterLevel: debaterLevel,
    roles,
  };
  validateAvailability(availability);
  return availability;
}

export async function bulkAddUserAvailabilityService(
  userId: string,
  data: Record<string, unknown>
): Promise<{ count: number; id: string }> {
  const slots = parseSlotPairs(data.slots);
  const { format, roles, judgeLevel, debaterLevel } = parseAvailabilityCommonFields(data);
  const customName =
    typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined;

  const availability = buildAvailability(
    uuidv6(),
    userId,
    slots,
    format,
    roles,
    judgeLevel,
    debaterLevel,
    customName,
  );

  await insertUserAvailability(getPool(), availability);
  return { count: slots.length, id: availability.id };
}

export async function updateUserAvailabilityService(
  userId: string,
  availabilityId: string,
  data: Record<string, unknown>
): Promise<void> {
  const pool = getPool();
  const existing = await getUserAvailability(pool, availabilityId, userId);
  if (!existing) throw new DomainValidationError("Availability not found");

  const updateFields = ["name", "slots", "format", "expectedJudgeLevel", "expectedDebaterLevel", "roles"];
  const changes = updateFields.filter((f) => f in data);
  if (!changes.length) throw new DomainValidationError("At least one field must be provided for update");

  const slots = "slots" in data
    ? parseSlotPairs(data.slots)
    : (existing.slots as Array<{ startDate: string; endDate: string }>).map((p) => ({
        start: CustomDateTime.fromStr(p.startDate),
        end: CustomDateTime.fromStr(p.endDate),
      }));

  const formatStr = (data.format as string) ?? (existing.format as string);
  if (!Object.values(TournamentRule).includes(formatStr as TournamentRule)) {
    throw new DomainValidationError(`Invalid format: ${formatStr}`);
  }
  const tournamentFormat = formatStr as TournamentRule;

  const rolesList = (data.roles as string[]) ?? (existing.roles as string[]);
  const roles = rolesList.map((r) => new AvailabilityRole(r));

  const judgeLevelVal = (data.expectedJudgeLevel as string) ?? (existing.expected_judge_level as string);
  const debaterLevelVal = (data.expectedDebaterLevel as string) ?? (existing.expected_debater_level as string);
  const judgeLevel = judgeLevelVal ? (judgeLevelVal as JudgeLevel) : null;
  const debaterLevel = debaterLevelVal ? (debaterLevelVal as DebaterLevel) : null;

  // Name precedence: explicit > preserved (when format/roles unchanged) > regenerate
  let nameToUse: string | undefined;
  if (typeof data.name === "string" && data.name.trim()) {
    nameToUse = data.name.trim();
  } else if (!("format" in data) && !("roles" in data)) {
    nameToUse = existing.name as string;
  }
  const availability = buildAvailability(
    availabilityId,
    userId,
    slots,
    tournamentFormat,
    roles,
    judgeLevel,
    debaterLevel,
    nameToUse,
  );

  await updateUserAvailability(pool, availability);
}

export async function deleteUserAvailabilityService(
  userId: string,
  availabilityId: string
): Promise<void> {
  const pool = getPool();
  const existing = await getUserAvailability(pool, availabilityId, userId);
  if (!existing) throw new DomainValidationError("Availability not found");
  await deleteUserAvailability(pool, availabilityId, userId);
}

export async function getOrCreateCalendarLinksService(
  userId: string,
  hostUrl: string
): Promise<Record<string, string>> {
  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT calendar_key FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) throw new Error("User not found");

  let calendarKey = rows[0].calendar_key as string | null;
  if (!calendarKey) {
    calendarKey = crypto.randomBytes(18).toString("base64url");
    await updateUserCalendarKey(pool, userId, calendarKey);
  }

  const cleanHost = hostUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const webcalUrl = `webcal://${cleanHost}/calendar/${calendarKey}.ics`;

  return {
    apple: webcalUrl,
    google: `https://calendar.google.com/calendar/render?cid=${webcalUrl}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${webcalUrl}&name=Debatium`,
  };
}
