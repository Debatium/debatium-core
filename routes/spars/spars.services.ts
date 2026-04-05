import { v6 as uuidv6 } from "uuid";
import type pg from "pg";
import { getPool } from "../../extensions/db.js";
import { DomainValidationError } from "../../db/exceptions.js";
import { CustomDateTime } from "../../db/users/domain.js";
import { type SparWithMembers, type InviteMember, InviteResponse } from "../../db/spars/domain.js";
import {
  createSpar, getAvailableSpars, getMyActiveSpars, getMyHistorySpars,
  getSparById, getSparMembers, insertSparMember, upsertSparMember,
  removeSparMember, updateSpar, updateSparStatus, updateSparHost, updateInviteMemberResponse,
} from "../../db/spars/queries.js";
import { getUserById, getUserByUsername, getUserByEmail } from "../../db/users/queries.js";
import { sendSparInviteEmail } from "../../extensions/email.js";
import { NotificationEventType } from "../../db/notifications/domain.js";
import { createNotification, notifyInAppAndEmail } from "../notifications/notifications.services.js";
import { NotificationChannel } from "../../db/notifications/domain.js";

interface InviteInput {
  email?: string;
  username?: string;
}

/**
 * Resolves invite inputs into full InviteMember objects (with both email + username when possible)
 * and returns them for storage in the DB. Also inserts spar_members and sends emails.
 */
async function resolveAndInvite(
  client: pg.PoolClient,
  sparId: string,
  hostUserId: string,
  hostName: string,
  invites: InviteInput[],
  sparEmailData: { sparName: string; sparTime: Date; rule: string; role: string; motion: string | null },
): Promise<InviteMember[]> {
  const resolved: InviteMember[] = [];

  for (const invite of invites) {
    let resolvedUser: { id: string; fullName: string; username: string; email: string } | null = null;

    if (invite.username) {
      resolvedUser = await getUserByUsername(client, invite.username);
      if (!resolvedUser) continue;
    } else if (invite.email) {
      const existing = await getUserByEmail(client, invite.email);
      if (existing) {
        resolvedUser = {
          id: existing.id as string,
          fullName: existing.fullName as string,
          username: existing.username as string,
          email: existing.email as string,
        };
      }
    }

    if (resolvedUser) {
      if (resolvedUser.id === hostUserId) continue;
      try {
        await insertSparMember(client, sparId, resolvedUser.id, sparEmailData.role, "invited");
      } catch {
        continue;
      }
      resolved.push({
        email: resolvedUser.email,
        username: resolvedUser.username,
        response: InviteResponse.PENDING,
      });

      // T-01: Notify invited user (in-app)
      await createNotification(client, {
        customerId: resolvedUser.id,
        eventType: NotificationEventType.INVITE_RECEIVED,
        channel: NotificationChannel.IN_APP,
        referenceId: sparId,
        referenceType: "spar_room",
        payload: {
          host_name: hostName,
          spar_room_id: sparId,
          context: `${hostName} invited you to "${sparEmailData.sparName}"`,
          cta: "View invitation",
        },
      });

      sendSparInviteEmail(resolvedUser.email, resolvedUser.fullName, hostName, {
        sparId, ...sparEmailData,
      }, true).catch(() => {});
    } else if (invite.email) {
      // User doesn't exist — email-only invite, no spar_member row
      resolved.push({
        email: invite.email,
        username: null,
        response: InviteResponse.PENDING,
      });
      sendSparInviteEmail(invite.email, invite.email, hostName, {
        sparId, ...sparEmailData,
      }, false).catch(() => {});
    }
  }

  return resolved;
}

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

  const invites: InviteInput[] = Array.isArray(data.invites) ? data.invites as InviteInput[] : [];

  const sparId = uuidv6();
  const sparData = {
    id: sparId,
    name: data.name,
    time: parsedTime,
    rule: data.rule ?? "wsdc",
    expected_debater_level: data.expectedDebaterLevel,
    expected_judge_level: data.expectedJudgeLevel ?? null,
    expecting_judge: expectingJudge,
    motion: data.motion ?? null,
    invite_members: [] as InviteMember[], // start empty, filled after resolve
  };
  const hostData = { user_id: userId, role: data.role ?? "debater" };

  return withTransaction(async (client) => {
    const createdSparId = await createSpar(client, sparData, hostData);

    if (invites.length > 0) {
      const hostUser = await getUserById(client, userId);
      const resolvedInvites = await resolveAndInvite(client, createdSparId, userId, hostUser?.fullName ?? "A host", invites, {
        sparName: data.name as string,
        sparTime: parsedTime,
        rule: (data.rule as string) ?? "wsdc",
        role: "debater",
        motion: (data.motion as string) ?? null,
      });

      // Store the resolved invite list back into the spar
      if (resolvedInvites.length > 0) {
        await client.query(
          `UPDATE spars SET invite_members = $1 WHERE id = $2`,
          [JSON.stringify(resolvedInvites), createdSparId]
        );
      }
    }

    return createdSparId;
  });
}

export async function updateSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  if (!sparId) throw new DomainValidationError("sparId is required");

  const parsedTime = CustomDateTime.fromStr(data.time as string).value;
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
  if (parsedTime < oneHourFromNow) {
    throw new DomainValidationError("Spar start time must be at least 1 hour from now");
  }

  await withTransaction(async (client) => {
    const spar = await getSparById(client, sparId);
    if (!spar) throw new DomainValidationError("Spar not found");
    if (spar.status !== "created") throw new DomainValidationError("Can only edit spars in created status");

    const members = await getSparMembers(client, sparId);
    const host = members.find(m => String(m.user_id) === userId && m.is_host);
    if (!host) throw new DomainValidationError("Only host can edit the spar");

    await updateSpar(client, sparId, {
      name: data.name as string,
      motion: (data.motion as string) ?? null,
      time: parsedTime,
      expected_debater_level: data.expectedDebaterLevel as string,
      expected_judge_level: (data.expectedJudgeLevel as string) ?? null,
    });
  });
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

    // T-02: Notify host about join request
    const host = members.find(m => m.is_host);
    if (host) {
      const requester = await getUserById(client, userId);
      await createNotification(client, {
        customerId: String(host.user_id),
        eventType: NotificationEventType.JOIN_REQUEST_RECEIVED,
        channel: NotificationChannel.IN_APP,
        referenceId: sparId,
        referenceType: "spar_room",
        payload: {
          requester_name: requester?.fullName ?? "Unknown",
          spar_room_id: sparId,
          context: `${requester?.fullName ?? "Someone"} wants to join "${spar.name}"`,
          cta: "Review request",
        },
      });
    }
  });
}

export async function inviteUserSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  const role = (data.role as string) ?? "debater";

  // Support userId, username, or email as the invite target
  const targetUserId = data.userId as string | undefined;
  const targetUsername = data.username as string | undefined;
  const targetEmail = data.email as string | undefined;

  if (!targetUserId && !targetUsername && !targetEmail) {
    throw new DomainValidationError("Provide userId, username, or email to invite");
  }

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const host = members.find(m => String(m.user_id) === userId && m.is_host);
    if (!host) throw new DomainValidationError("Only host can invite");

    const spar = await getSparById(client, sparId);
    if (!spar) throw new DomainValidationError("Spar not found");
    const hostUser = await getUserById(client, userId);

    const sparTime = spar.time instanceof Date ? spar.time : new Date(spar.time as string);
    const sparEmailData = {
      sparId,
      sparName: spar.name as string,
      sparTime,
      rule: spar.rule as string,
      role,
      motion: (spar.motion as string) ?? null,
    };

    // Resolve the target user
    let resolvedUser: { id: string; fullName: string; email: string } | null = null;

    if (targetUserId) {
      resolvedUser = await getUserById(client, targetUserId);
      if (!resolvedUser) throw new DomainValidationError("User not found");
    } else if (targetUsername) {
      resolvedUser = await getUserByUsername(client, targetUsername);
      if (!resolvedUser) throw new DomainValidationError("User not found");
    } else if (targetEmail) {
      const existing = await getUserByEmail(client, targetEmail);
      if (existing) {
        resolvedUser = { id: existing.id as string, fullName: existing.fullName as string, email: existing.email as string };
      }
    }

    if (resolvedUser) {
      if (members.some(m => String(m.user_id) === resolvedUser!.id)) {
        throw new DomainValidationError("User is already a member of this spar");
      }
      await insertSparMember(client, sparId, resolvedUser.id, role, "invited");

      // T-01: Notify invited user
      await createNotification(client, {
        customerId: resolvedUser.id,
        eventType: NotificationEventType.INVITE_RECEIVED,
        channel: NotificationChannel.IN_APP,
        referenceId: sparId,
        referenceType: "spar_room",
        payload: {
          host_name: hostUser?.fullName ?? "Unknown",
          spar_room_id: sparId,
          context: `${hostUser?.fullName ?? "Someone"} invited you to "${spar?.name ?? "a spar"}"`,
          cta: "View invitation",
        },
      });

      if (hostUser) {
        sendSparInviteEmail(resolvedUser.email, resolvedUser.fullName, hostUser.fullName, sparEmailData, true).catch(() => {});
      }
    } else if (targetEmail) {
      // User not registered — send email-only invite
      if (hostUser) {
        sendSparInviteEmail(targetEmail, targetEmail, hostUser.fullName, sparEmailData, false).catch(() => {});
      }
    }
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
    const spar = await getSparById(client, sparId);
    const sparName = (spar?.name as string) ?? "a spar";

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

      // T-03: Notify target user their request was APPROVED
      const hostUser = await getUserById(client, userId);
      const targetUser = await getUserById(client, targetUserId);
      await notifyInAppAndEmail(client, {
        customerId: targetUserId,
        eventType: NotificationEventType.REQUEST_DECISION,
        referenceId: sparId,
        payload: {
          host_name: hostUser?.fullName ?? "Unknown",
          spar_room_id: sparId,
          status: "APPROVED",
          context: `${hostUser?.fullName ?? "Host"} approved your request to join "${sparName}"`,
          cta: "Go to waiting room",
        },
        email: targetUser?.email ? {
          toEmail: targetUser.email,
          subject: "Spar Join Request Approved",
          htmlContent: `<p>Your request to join "${sparName}" has been approved by ${hostUser?.fullName ?? "the host"}. Head to the waiting room!</p>`,
        } : undefined,
      });
    } else {
      const me = members.find(m => String(m.user_id) === userId);
      if (!me || me.status !== "invited") throw new DomainValidationError("You have not been invited to this spar");
      if (me.role === "judge") {
        const judgeCount = members.filter(m => m.role === "judge" && m.status === "accepted").length;
        if (judgeCount >= 1) throw new DomainValidationError("A spar room can only have one judge");
      }
      await upsertSparMember(client, sparId, userId, me.role as string, "accepted");

      // Notify host that invited user accepted
      const host = members.find(m => m.is_host);
      const user = await getUserById(client, userId);
      if (host && user) {
        await createNotification(client, {
          customerId: String(host.user_id),
          eventType: NotificationEventType.REQUEST_DECISION,
          channel: NotificationChannel.IN_APP,
          referenceId: sparId,
          referenceType: "spar_room",
          payload: {
            requester_name: user.fullName,
            spar_room_id: sparId,
            status: "ACCEPTED",
            context: `${user.fullName} accepted your invitation to "${sparName}"`,
            cta: "View spar",
          },
        });
      }

      // Sync invite_members response
      if (user) {
        await updateInviteMemberResponse(client, sparId, { email: user.email }, InviteResponse.ACCEPTED);
        await updateInviteMemberResponse(client, sparId, { username: user.username }, InviteResponse.ACCEPTED);
      }
    }
  });
}

export async function declineRequestSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  const targetUserId = data.targetUserId as string | undefined;

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const spar = await getSparById(client, sparId);
    const sparName = (spar?.name as string) ?? "a spar";

    if (targetUserId && targetUserId !== userId) {
      const host = members.find(m => String(m.user_id) === userId && m.is_host);
      if (!host) throw new DomainValidationError("Only host can decline others");
      await removeSparMember(client, sparId, targetUserId);

      // T-03: Notify target user their request was REJECTED
      const hostUser = await getUserById(client, userId);
      const targetUser = await getUserById(client, targetUserId);
      await notifyInAppAndEmail(client, {
        customerId: targetUserId,
        eventType: NotificationEventType.REQUEST_DECISION,
        referenceId: sparId,
        payload: {
          host_name: hostUser?.fullName ?? "Unknown",
          spar_room_id: sparId,
          status: "REJECTED",
          context: `${hostUser?.fullName ?? "Host"} declined your request to join "${sparName}"`,
          cta: "Find another match",
        },
        email: targetUser?.email ? {
          toEmail: targetUser.email,
          subject: "Spar Join Request Declined",
          htmlContent: `<p>Your request to join "${sparName}" has been declined by ${hostUser?.fullName ?? "the host"}. Find another match!</p>`,
        } : undefined,
      });

      // Sync invite_members response for the declined user
      if (targetUser) {
        await updateInviteMemberResponse(client, sparId, { email: targetUser.email }, InviteResponse.DECLINED);
        await updateInviteMemberResponse(client, sparId, { username: targetUser.username }, InviteResponse.DECLINED);
      }
    } else {
      const me = members.find(m => String(m.user_id) === userId);
      if (!me || me.status !== "invited") throw new DomainValidationError("You have not been invited to this spar");
      await removeSparMember(client, sparId, userId);

      // Notify host that invited user declined
      const host = members.find(m => m.is_host);
      const user = await getUserById(client, userId);
      if (host && user) {
        await createNotification(client, {
          customerId: String(host.user_id),
          eventType: NotificationEventType.REQUEST_DECISION,
          channel: NotificationChannel.IN_APP,
          referenceId: sparId,
          referenceType: "spar_room",
          payload: {
            requester_name: user.fullName,
            spar_room_id: sparId,
            status: "DECLINED",
            context: `${user.fullName} declined your invitation to "${sparName}"`,
            cta: "View spar",
          },
        });
      }

      // Sync invite_members response
      if (user) {
        await updateInviteMemberResponse(client, sparId, { email: user.email }, InviteResponse.DECLINED);
        await updateInviteMemberResponse(client, sparId, { username: user.username }, InviteResponse.DECLINED);
      }
    }
  });
}

export async function leaveSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const spar = await getSparById(client, sparId);
    const sparName = (spar?.name as string) ?? "a spar";
    const me = members.find(m => String(m.user_id) === userId);
    if (me && me.is_host) {
      const judges = members.filter(m => m.role === "judge" && String(m.user_id) !== userId);
      const others = members.filter(m => String(m.user_id) !== userId);
      let newHostId: string | null = null;
      if (judges.length) newHostId = String(judges[0].user_id);
      else if (others.length) newHostId = String(others[0].user_id);

      if (newHostId) {
        await updateSparHost(client, sparId, newHostId, true);

        // T-06: Notify new host
        await createNotification(client, {
          customerId: newHostId,
          eventType: NotificationEventType.ASSIGNED_AS_HOST,
          channel: NotificationChannel.IN_APP,
          referenceId: sparId,
          referenceType: "spar_room",
          payload: {
            spar_room_id: sparId,
            context: `You've been assigned as the new host of "${sparName}"`,
            cta: "Manage spar room",
          },
        });
      }
    }
    await removeSparMember(client, sparId, userId);
  });
}

export async function kickMemberSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;
  const targetUserId = data.targetUserId as string;

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const spar = await getSparById(client, sparId);
    const sparName = (spar?.name as string) ?? "a spar";
    const host = members.find(m => String(m.user_id) === userId && m.is_host);
    if (!host) throw new DomainValidationError("Only host can kick");
    await removeSparMember(client, sparId, targetUserId);

    // T-07: Notify kicked user
    const targetUser = await getUserById(client, targetUserId);
    await notifyInAppAndEmail(client, {
      customerId: targetUserId,
      eventType: NotificationEventType.REMOVED_FROM_SPAR,
      referenceId: sparId,
      payload: {
        spar_room_id: sparId,
        context: `You were removed from "${sparName}"`,
        cta: "Find a new match",
      },
      email: targetUser?.email ? {
        toEmail: targetUser.email,
        subject: "Removed from Spar Room",
        htmlContent: `<p>You have been removed from "${sparName}". Find another match!</p>`,
      } : undefined,
    });
  });
}

export async function cancelSparService(userId: string, data: Record<string, unknown>): Promise<void> {
  const sparId = data.sparId as string;

  await withTransaction(async (client) => {
    const members = await getSparMembers(client, sparId);
    const spar = await getSparById(client, sparId);
    const sparName = (spar?.name as string) ?? "a spar";
    const host = members.find(m => String(m.user_id) === userId && m.is_host);
    if (!host) throw new DomainValidationError("Only host can cancel");
    await updateSparStatus(client, sparId, "cancelled");

    // T-05: Notify all accepted members (except host)
    const acceptedMembers = members.filter(m => m.status === "accepted" && String(m.user_id) !== userId);
    for (const member of acceptedMembers) {
      const memberId = String(member.user_id);
      const memberUser = await getUserById(client, memberId);
      await notifyInAppAndEmail(client, {
        customerId: memberId,
        eventType: NotificationEventType.SPAR_CANCELLED,
        referenceId: sparId,
        payload: {
          spar_room_id: sparId,
          context: `"${sparName}" has been cancelled by the host`,
          cta: "Discover spars",
        },
        email: memberUser?.email ? {
          toEmail: memberUser.email,
          subject: "Spar Room Cancelled",
          htmlContent: `<p>"${sparName}" has been cancelled by the host.</p>`,
        } : undefined,
      });
    }
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
