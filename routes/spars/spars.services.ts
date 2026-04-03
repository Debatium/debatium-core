import { v6 as uuidv6 } from "uuid";
import type pg from "pg";
import { getPool } from "../../extensions/db.js";
import { DomainValidationError } from "../../db/exceptions.js";
import { CustomDateTime } from "../../db/users/domain.js";
import type { SparWithMembers } from "../../db/spars/domain.js";
import {
  createSpar, getAvailableSpars, getMyActiveSpars, getMyHistorySpars,
  getSparById, getSparMembers, insertSparMember, upsertSparMember,
  removeSparMember, updateSparStatus, updateSparHost,
} from "../../db/spars/queries.js";

async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createSparService(
  userId: string,
  data: Record<string, unknown>
): Promise<string> {
  const parsedTime = CustomDateTime.fromStr(data.time as string).value;

  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
  if (parsedTime < oneHourFromNow) {
    throw new DomainValidationError("Spar start time must be at least 1 hour from now");
  }
  if (!data.expectedDebaterLevel) {
    throw new DomainValidationError("expectedDebaterLevel is required");
  }

  const expectingJudge = "expectedJudgeLevel" in data;

  const sparData = {
    id: uuidv6(),
    name: data.name,
    time: parsedTime,
    rule: data.rule ?? "wsdc",
    expected_debater_level: data.expectedDebaterLevel,
    expected_judge_level: data.expectedJudgeLevel ?? null,
    expecting_judge: expectingJudge,
    motion: data.motion ?? null,
  };
  const hostData = { user_id: userId, role: data.role ?? "debater" };

  return withTransaction(client => createSpar(client, sparData, hostData));
}

export async function listAvailableSparsService(userId?: string): Promise<SparWithMembers[]> {
  const pool = getPool();
  return getAvailableSpars(pool, userId);
}

export async function listMyActiveSparsService(userId: string): Promise<SparWithMembers[]> {
  const pool = getPool();
  const spars = await getMyActiveSpars(pool, userId);
  for (const s of spars) {
    s.isHost = s.members.some(m => m.userId === userId && m.isHost);
    if (s.isHost) {
      s.notifications = s.members.filter(m => m.status === "pending");
    } else {
      s.notifications = s.members.filter(m => m.status === "invited" && m.userId === userId);
    }
  }
  return spars;
}

export async function listMyHistorySparsService(userId: string): Promise<SparWithMembers[]> {
  const pool = getPool();
  return getMyHistorySpars(pool, userId);
}

export async function requestJoinSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  const role = (data.role as string) ?? "debater";

  await withTransaction(async (client) => {
    const spar = await getSparById(client, sparId);
    if (!spar) throw new DomainValidationError("Spar not found");
    if (spar.status === "debating" && role !== "observer") {
      throw new DomainValidationError("Can only join as observer during debate");
    }

    const members = await getSparMembers(client, sparId);
    if (members.some(m => String(m.user_id) === userId)) {
      throw new DomainValidationError("You are already a member of this spar");
    }

    await insertSparMember(client, sparId, userId, role, "pending");
  });
}

export async function inviteUserSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  const targetUserId = data.userId as string;
  const role = (data.role as string) ?? "debater";

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const host = members.find(m => String(m.user_id) === userId && m.is_host);
    if (!host) throw new DomainValidationError("Only host can invite");
    if (members.some(m => String(m.user_id) === targetUserId)) {
      throw new DomainValidationError("User is already a member of this spar");
    }
    await insertSparMember(client, sparId, targetUserId, role, "invited");
  });
}

export async function matchingRequestSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  if (!sparId) throw new DomainValidationError("sparId is required");

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const host = members.find(m => String(m.user_id) === userId && m.is_host);
    if (!host) throw new DomainValidationError("Only host can start matching");
    await updateSparStatus(client, sparId, "matching");
  });
}

export async function acceptRequestSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  const targetUserId = data.targetUserId as string | undefined;

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);

    if (targetUserId) {
      const host = members.find(m => String(m.user_id) === userId && m.is_host);
      if (!host) throw new DomainValidationError("Only host can accept join requests");
      const target = members.find(m => String(m.user_id) === targetUserId);
      if (!target || target.status !== "pending") throw new DomainValidationError("No pending request found for this user");
      if (target.role === "judge") {
        const judgeCount = members.filter(m => m.role === "judge" && m.status === "accepted").length;
        if (judgeCount >= 1) throw new DomainValidationError("A spar room can only have one judge");
      }
      await upsertSparMember(client, sparId, targetUserId, target.role as string, "accepted");
    } else {
      const me = members.find(m => String(m.user_id) === userId);
      if (!me || me.status !== "invited") throw new DomainValidationError("You have not been invited to this spar");
      if (me.role === "judge") {
        const judgeCount = members.filter(m => m.role === "judge" && m.status === "accepted").length;
        if (judgeCount >= 1) throw new DomainValidationError("A spar room can only have one judge");
      }
      await upsertSparMember(client, sparId, userId, me.role as string, "accepted");
    }
  });
}

export async function declineRequestSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  const targetUserId = data.targetUserId as string | undefined;

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);

    if (targetUserId && targetUserId !== userId) {
      const host = members.find(m => String(m.user_id) === userId && m.is_host);
      if (!host) throw new DomainValidationError("Only host can decline others");
      await removeSparMember(client, sparId, targetUserId);
    } else {
      const me = members.find(m => String(m.user_id) === userId);
      if (!me || me.status !== "invited") throw new DomainValidationError("You have not been invited to this spar");
      await removeSparMember(client, sparId, userId);
    }
  });
}

export async function leaveSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const me = members.find(m => String(m.user_id) === userId);
    if (me && me.is_host) {
      const judges = members.filter(m => m.role === "judge" && String(m.user_id) !== userId);
      const others = members.filter(m => String(m.user_id) !== userId);
      if (judges.length) await updateSparHost(client, sparId, String(judges[0].user_id), true);
      else if (others.length) await updateSparHost(client, sparId, String(others[0].user_id), true);
    }
    await removeSparMember(client, sparId, userId);
  });
}

export async function kickMemberSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  const targetUserId = data.targetUserId as string;

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const host = members.find(m => String(m.user_id) === userId && m.is_host);
    if (!host) throw new DomainValidationError("Only host can kick");
    await removeSparMember(client, sparId, targetUserId);
  });
}

export async function cancelSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const host = members.find(m => String(m.user_id) === userId && m.is_host);
    if (!host) throw new DomainValidationError("Only host can cancel");
    await updateSparStatus(client, sparId, "cancelled");
  });
}

export async function cancelMatchingSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  if (!sparId) throw new DomainValidationError("sparId is required");

  await withTransaction(async (client) => {
    const spar = await getSparById(client, sparId);
    if (!spar) throw new DomainValidationError("Spar not found");
    if (spar.status !== "matching") throw new DomainValidationError("Can only cancel matching if the spar is in matching status");

    const members = await getSparMembers(client, sparId);
    const host = members.find(m => String(m.user_id) === userId && m.is_host);
    if (!host) throw new DomainValidationError("Only host can cancel matching");

    await updateSparStatus(client, sparId, "created");
  });
}
