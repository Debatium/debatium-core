import crypto from "crypto";
import { v6 as uuidv6 } from "uuid";
import argon2 from "argon2";
import { getPool } from "../../extensions/db.js";
import { getRedis } from "../../extensions/redis.js";
import { DomainValidationError } from "../../db/exceptions.js";
import { ValueError } from "./auth.routes.js";
import {
  signAccessToken, signRefreshToken, verifyRefreshToken,
  REFRESH_TOKEN_EXPIRY_SECONDS,
} from "../../utils/jwt.js";
import {
  FullName, Username, Email, Institution, Password, AvatarURL,
  DebaterLevel, JudgeLevel, UserRole,
  type User,
} from "../../db/users/domain.js";
import {
  TournamentName, TournamentYear, TournamentScale, TournamentRule,
  JudgeRounds, JudgeHighestRank, BreakingRank, Achievement, EntryRole,
  type Tournament, type JudgeDetails, type DebaterDetails,
} from "../../db/tournaments/domain.js";
import { insertUser } from "../../db/users/queries.js";
import {
  findTournament, insertTournament, insertJudgeDetails, insertDebaterDetails,
  insertTournamentEntry,
} from "../../db/tournaments/queries.js";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; fullName: string; username: string; email: string; avatarURL: string; role: string };
}

// ── Login ──

export async function loginService(
  email: string,
  password: string
): Promise<AuthTokens> {
  const pool = getPool();

  const result = await pool.query(
    "SELECT id, password, full_name, username, email, avatar_url, role FROM users WHERE email = $1",
    [email]
  );

  const user = result.rows[0];
  if (!user) {
    throw new ValueError("Invalid email or password.");
  }

  const valid = await argon2.verify(user.password, password);
  if (!valid) {
    throw new ValueError("Invalid email or password.");
  }

  const userId = String(user.id);

  const role = user.role ?? "user";

  // Generate tokens
  const accessToken = signAccessToken({ userId, role });
  const refreshToken = signRefreshToken({ userId, role });

  // Store refresh token in Redis (invalidate old one)
  const redis = getRedis();
  const refreshKey = `refresh:${userId}`;
  const oldToken = await redis.get<string>(refreshKey);
  if (oldToken) await redis.del(`rt:${oldToken}`);

  // Store: refreshKey -> token, rt:token -> userId
  await redis.set(refreshKey, refreshToken, { ex: REFRESH_TOKEN_EXPIRY_SECONDS });
  await redis.set(`rt:${refreshToken}`, userId, { ex: REFRESH_TOKEN_EXPIRY_SECONDS });

  return {
    accessToken,
    refreshToken,
    user: {
      id: userId,
      fullName: user.full_name,
      username: user.username,
      email: user.email,
      avatarURL: String(user.avatar_url ?? "1"),
      role,
    },
  };
}

// ── Refresh ──

export async function refreshService(refreshToken: string): Promise<{ accessToken: string }> {
  // Verify the JWT signature
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ValueError("Invalid or expired refresh token.");
  }

  // Check if refresh token is still valid in Redis
  const redis = getRedis();
  const storedUserId = await redis.get<string>(`rt:${refreshToken}`);
  if (!storedUserId || storedUserId !== payload.userId) {
    throw new ValueError("Invalid or expired refresh token.");
  }

  // Fetch current role from DB (in case it changed since login)
  const pool = getPool();
  const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [payload.userId]);
  const role = rows[0]?.role ?? "user";

  // Issue new access token
  return { accessToken: signAccessToken({ userId: payload.userId, role }) };
}

// ── Logout ──

export async function logoutService(userId: string): Promise<void> {
  const redis = getRedis();
  const refreshKey = `refresh:${userId}`;
  const token = await redis.get<string>(refreshKey);
  if (token) await redis.del(`rt:${token}`);
  await redis.del(refreshKey);
}

// ── Register ──

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

export async function registerUserService(data: Record<string, unknown>): Promise<void> {
  const fullName = new FullName(data.fullName as string);
  const username = new Username(data.username as string);
  const email = new Email(data.email as string);
  const institution = new Institution(data.institution as string | null);
  const password = new Password(data.password as string);
  const avatarVal = data.avatarURL ? Number(data.avatarURL) : 1;
  const avatarUrl = new AvatarURL(avatarVal);

  const passwordHash = await hashPassword(password.value);
  const calendarKey = crypto.randomBytes(18).toString("base64url");
  const userId = uuidv6();

  const user: User = {
    id: userId,
    fullName,
    username,
    passwordHash,
    email,
    role: UserRole.USER,
    debaterLevel: DebaterLevel.NOVICE,
    judgeLevel: JudgeLevel.NOVICE,
    debaterScore: 0.0,
    judgeScore: 0.0,
    institution,
    avatarUrl,
    calendarKey,
    availableBalance: 0,
    frozenBalance: 0,
  };

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertUser(client, user);
    const entries = (data.tournamentEntries as Record<string, unknown>[]) ?? [];
    await processTournamentEntries(client, userId, entries);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
