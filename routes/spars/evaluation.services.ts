import type pg from "pg";
import { getPool } from "../../extensions/db.js";
import { DomainValidationError, PermissionDeniedError } from "../../db/exceptions.js";
import { TournamentRule } from "../../db/tournaments/domain.js";
import { getSparById, getSparMembers } from "../../db/spars/queries.js";
import { BallotPayload, FeedbackPayload } from "../../db/spars/evaluation.domain.js";
import {
  insertBallot,
  insertFeedback,
  getBallotBySparId,
  getFeedbacksBySparId,
  getFeedbackByDebater,
} from "../../db/spars/evaluation.queries.js";
import { createNotification } from "../notifications/notifications.services.js";
import { NotificationChannel, NotificationEventType } from "../../db/notifications/domain.js";

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

function getEvaluationWindow(startTime: any) {
  const sparTime = startTime instanceof Date ? startTime : new Date(startTime as string);
  const canEvaluateAt = new Date(sparTime.getTime() + 30 * 60 * 1000);
  const windowEnd = new Date(canEvaluateAt.getTime() + 48 * 60 * 60 * 1000);
  return { sparTime, canEvaluateAt, windowEnd };
}

export async function submitBallotService(userId: string, data: any): Promise<void> {
  const { sparId, teams, replySpeeches } = data;
  if (!sparId) throw new DomainValidationError("sparId is required");

  await withTransaction(async (client) => {
    const spar = await getSparById(client, sparId);
    if (!spar) throw new DomainValidationError("Spar not found");

    // 1-6. Status and Window Guards
    const { canEvaluateAt, windowEnd } = getEvaluationWindow(spar.time);
    const now = Date.now();

    if (spar.status === "cancelled") throw new DomainValidationError("Spar is cancelled, evaluation is not available.");
    if (!spar.expecting_judge) throw new DomainValidationError("This spar does not have a judge.");
    
    if (now < canEvaluateAt.getTime()) {
      throw new DomainValidationError("Evaluation is only available 30 minutes after the spar start time.");
    }
    if (now > windowEnd.getTime()) {
      throw new DomainValidationError("The 48-hour evaluation window has closed.");
    }
    // We no longer strictly require status 'done', as evaluation is time-based.

    // 7. Verify judge membership
    const members = await getSparMembers(client, sparId);
    const isJudge = members.some(m => String(m.user_id) === userId && m.role === "judge" && m.status === "accepted");
    if (!isJudge) throw new PermissionDeniedError("Only the accepted judge can submit a ballot.");

    // 8. Check if ballot exists
    const existingBallot = await getBallotBySparId(client, sparId);
    if (existingBallot) throw new DomainValidationError("Ballot already submitted. Submissions are final.");

    // 9. Domain Validation
    const format = spar.rule as TournamentRule;
    const payload = new BallotPayload(sparId, format, teams, replySpeeches);

    // 10. Bidirectional member validation
    const acceptedDebaters = members.filter(m => m.role === "debater" && m.status === "accepted");
    const debaterIds = new Set(acceptedDebaters.map(m => String(m.user_id)));
    const payloadUserIds = Object.values(teams).flat().map((s: any) => String(s.userId));
    
    if (payloadUserIds.length !== debaterIds.size) {
      throw new DomainValidationError("Ballot speakers do not match spar members count.");
    }
    for (const pid of payloadUserIds) {
      if (!debaterIds.has(pid)) throw new DomainValidationError(`User ${pid} is not an accepted debater in this spar.`);
    }

    // 12. Compute Placements
    const placements = computePlacements(format, teams, replySpeeches);
    
    // 13. Persistence
    await insertBallot(client, sparId, userId, { teams, replySpeeches: replySpeeches || null }, placements);

    // 14. Notifications
    for (const debater of acceptedDebaters) {
      await createNotification(client, {
        customerId: String(debater.user_id),
        eventType: NotificationEventType.BALLOT_SUBMITTED,
        channel: NotificationChannel.IN_APP,
        referenceId: sparId,
        referenceType: "spar_room",
        payload: { sparName: spar.name },
      });
    }
  });
}

export async function submitFeedbackService(userId: string, data: any): Promise<void> {
  const { sparId, rating, comment, isAnonymous } = data;
  if (!sparId) throw new DomainValidationError("sparId is required");

  await withTransaction(async (client) => {
    const spar = await getSparById(client, sparId);
    if (!spar) throw new DomainValidationError("Spar not found");

    const { canEvaluateAt, windowEnd } = getEvaluationWindow(spar.time);
    const now = Date.now();

    if (spar.status === "cancelled") throw new DomainValidationError("Spar is cancelled.");
    if (!spar.expecting_judge) throw new DomainValidationError("This spar does not have a judge.");
    
    if (now < canEvaluateAt.getTime()) {
      throw new DomainValidationError("Feedback is only available 30 minutes after the spar start time.");
    }
    if (now > windowEnd.getTime()) {
      throw new DomainValidationError("The 48-hour evaluation window has closed.");
    }

    // Verify debater membership
    const members = await getSparMembers(client, sparId);
    const isDebater = members.some(m => String(m.user_id) === userId && m.role === "debater" && m.status === "accepted");
    if (!isDebater) throw new PermissionDeniedError("Only accepted debaters can submit feedback.");

    // Check existing
    const existing = await getFeedbackByDebater(client, sparId, userId);
    if (existing) throw new DomainValidationError("Feedback already submitted. Submissions are final.");

    // Domain validation
    new FeedbackPayload(sparId, rating, comment, isAnonymous);

    // Persistence
    await insertFeedback(client, sparId, userId, rating, comment ?? null, isAnonymous);

    // Notify judge ONLY if ballot exists
    const ballot = await getBallotBySparId(client, sparId);
    if (ballot) {
      const judge = members.find(m => m.role === "judge" && m.status === "accepted");
      if (judge) {
        await createNotification(client, {
          customerId: String(judge.user_id),
          eventType: NotificationEventType.FEEDBACK_SUBMITTED,
          channel: NotificationChannel.IN_APP,
          referenceId: sparId,
          referenceType: "spar_room",
          payload: { sparName: spar.name },
        });
      }
    }
  });
}

export async function getEvaluationDataService(userId: string, sparId: string): Promise<any> {
  const pool = getPool();
  const spar = await getSparById(pool, sparId);
  if (!spar) throw new DomainValidationError("Spar not found");

  if (!spar.expecting_judge) return { status: "disabled" };

  const members = await getSparMembers(pool, sparId);
  const member = members.find(m => String(m.user_id) === userId && m.status === "accepted");
  if (!member) throw new PermissionDeniedError("You are not an accepted member of this spar.");
  
  const role = member.role;
  if (role === "observer") throw new PermissionDeniedError("Observers cannot access evaluation data.");

  const { canEvaluateAt, windowEnd } = getEvaluationWindow(spar.time);
  const now = Date.now();
  const isWindowExpired = now > windowEnd.getTime();
  const isTooEarly = now < canEvaluateAt.getTime();

  if (role === "debater") {
    const ballot = await getBallotBySparId(pool, sparId);
    const feedback = await getFeedbackByDebater(pool, sparId, userId);

    if (ballot) {
      return { 
        status: "complete", 
        ballot,
        feedbackSubmitted: !!feedback
      };
    }

    if (isWindowExpired) {
      return { status: "draw", message: "The judge did not submit a ballot. The match is scored as a draw." };
    }

    if (isTooEarly) {
      return { 
        status: "pending", 
        message: "Evaluation will be available 30 minutes after the spar start time.",
        feedbackSubmitted: !!feedback
      };
    }

    return { 
      status: "pending", 
      message: "Waiting for the judge to submit the ballot.",
      feedbackSubmitted: !!feedback
    };
  }

  if (role === "judge") {
    const ballot = await getBallotBySparId(pool, sparId);
    if (!ballot) {
      if (isTooEarly) return { status: "pending", message: "Evaluation will be available 30 minutes after the spar start time." };
      if (!isWindowExpired) return { status: "pending", message: "Submit your ballot to unlock debater feedback." };
    }

    const feedbacks = await getFeedbacksBySparId(pool, sparId);
    const sanitizedFeedbacks = feedbacks.map(f => {
      const rating = typeof f.rating === "string" ? parseFloat(f.rating) : f.rating;
      if (f.isAnonymous) {
        return { sparId: f.sparId, rating, comment: f.comment, isAnonymous: true, createdAt: f.createdAt };
      }
      return { ...f, rating };
    });

    return { status: "complete", feedbacks: sanitizedFeedbacks };
  }

  throw new PermissionDeniedError("Invalid role for evaluation data.");
}

function computePlacements(format: TournamentRule, teams: any, replySpeeches?: any): any[] {
  const results: { team: string; totalScore: number }[] = [];

  for (const [team, speakers] of Object.entries(teams)) {
    let total = (speakers as any[]).reduce((sum, s) => sum + (s.score || 0), 0);
    if (format === TournamentRule.WSDC && replySpeeches?.[team]) {
      total += replySpeeches[team].score || 0;
    }
    results.push({ team, totalScore: total });
  }

  // Tie detection
  const scores = results.map(r => r.totalScore);
  const uniqueScores = new Set(scores);
  if (uniqueScores.size !== scores.length) {
    throw new DomainValidationError("Tied scores are not allowed. Adjust scores to produce a clear ranking.");
  }

  // Sort and rank
  results.sort((a, b) => b.totalScore - a.totalScore);
  return results.map((r, i) => ({ ...r, rank: i + 1 }));
}
