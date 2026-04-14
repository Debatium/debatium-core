import type pg from "pg";
import { getPool } from "../../extensions/db.js";
import { DomainValidationError, PermissionDeniedError } from "../../db/exceptions.js";
import { TournamentRule } from "../../db/tournaments/domain.js";
import { getSparById, getSparMembers } from "../../db/spars/queries.js";
import { BallotPayload, FeedbackPayload } from "../../db/spars/evaluation.domain.js";
import type { FeedbackEntry } from "../../db/spars/evaluation.domain.js";
import {
  ensureEvaluation,
  getEvaluationBySparId,
  submitBallot,
  appendFeedback,
} from "../../db/spars/evaluation.queries.js";
import { createNotification } from "../notifications/notifications.services.js";
import { NotificationChannel, NotificationEventType } from "../../db/notifications/domain.js";
import { releaseBalance } from "../../db/users/queries.js";

const SPAR_FEE = 10;
const PLATFORM_FEE_PERCENT = 15;

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


function getJudgeId(members: any[]): string | null {
  const judge = members.find(m => m.role === "judge" && m.status === "accepted");
  return judge ? String(judge.user_id) : null;
}

export async function submitBallotService(userId: string, data: any): Promise<void> {
    const { sparId, teams, replySpeeches, teamFeedbacks, rfd } = data;
  if (!sparId) throw new DomainValidationError("sparId is required");

  await withTransaction(async (client) => {
    const spar = await getSparById(client, sparId);
    if (!spar) throw new DomainValidationError("Spar not found");

    if (spar.status === "cancelled") throw new DomainValidationError("Spar is cancelled, evaluation is not available.");
    if (!spar.expecting_judge) throw new DomainValidationError("This spar does not have a judge.");
    if (spar.status !== "evaluating") throw new DomainValidationError("Ballot submission is only open during the evaluation phase.");

    const members = await getSparMembers(client, sparId);
    const isJudge = members.some(m => String(m.user_id) === userId && m.role === "judge" && m.status === "accepted");
    if (!isJudge) throw new PermissionDeniedError("Only the accepted judge can submit a ballot.");

    // Ensure evaluation row exists
    const evaluation = await ensureEvaluation(client, sparId, userId);
    if (evaluation.status === "submitted") {
      throw new DomainValidationError("Ballot already submitted. Submissions are final.");
    }

    // Domain Validation
    const format = spar.rule as TournamentRule;
    const payload = new BallotPayload(sparId, format, teams, replySpeeches);

    // Bidirectional member validation
    const acceptedDebaters = members.filter(m => m.role === "debater" && m.status === "accepted");
    const debaterIds = new Set(acceptedDebaters.map(m => String(m.user_id)));
    const payloadUserIds = Object.values(teams).flat().map((s: any) => String(s.userId));

    if (payloadUserIds.length !== debaterIds.size) {
      throw new DomainValidationError("Ballot speakers do not match spar members count.");
    }
    for (const pid of payloadUserIds) {
      if (!debaterIds.has(pid)) throw new DomainValidationError(`User ${pid} is not an accepted debater in this spar.`);
    }

    // Compute Placements
    const placements = computePlacements(format, teams, replySpeeches);

    // Persistence — update the evaluation row
    const resultsJson: Record<string, unknown> = { teams, replySpeeches: replySpeeches || null };
    if (teamFeedbacks && typeof teamFeedbacks === "object") {
      resultsJson.teamFeedbacks = teamFeedbacks;
    }
    if (rfd && typeof rfd === "string" && rfd.trim()) {
      resultsJson.rfd = rfd.trim();
    }
    await submitBallot(client, sparId, resultsJson, placements);

    // Release coin funds from each debater to the judge
    const judgeId = String(userId);
    for (const debater of acceptedDebaters) {
      await releaseBalance(client, String(debater.user_id), judgeId, SPAR_FEE, PLATFORM_FEE_PERCENT);
    }

    // Notifications
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

    if (spar.status === "cancelled") throw new DomainValidationError("Spar is cancelled.");
    if (!spar.expecting_judge) throw new DomainValidationError("This spar does not have a judge.");
    if (spar.status !== "evaluating") throw new DomainValidationError("Feedback submission is only open during the evaluation phase.");

    const members = await getSparMembers(client, sparId);
    const isDebater = members.some(m => String(m.user_id) === userId && m.role === "debater" && m.status === "accepted");
    if (!isDebater) throw new PermissionDeniedError("Only accepted debaters can submit feedback.");

    // Ensure evaluation row exists
    const judgeId = getJudgeId(members);
    if (!judgeId) throw new DomainValidationError("No accepted judge found for this spar.");
    const evaluation = await ensureEvaluation(client, sparId, judgeId);

    // Check if this debater already submitted feedback
    const alreadySubmitted = evaluation.feedbacksJson.some(
      (f: FeedbackEntry) => f.debaterId === userId
    );
    if (alreadySubmitted) throw new DomainValidationError("Feedback already submitted. Submissions are final.");

    // Domain validation
    new FeedbackPayload(sparId, rating, comment, isAnonymous);

    // Append feedback to JSON array
    const feedbackEntry: FeedbackEntry = {
      debaterId: userId,
      rating,
      comment: comment ?? null,
      isAnonymous,
      createdAt: new Date().toISOString(),
    };
    await appendFeedback(client, sparId, feedbackEntry);

    // Notify judge ONLY if ballot is submitted
    if (evaluation.status === "submitted") {
      await createNotification(client, {
        customerId: judgeId,
        eventType: NotificationEventType.FEEDBACK_SUBMITTED,
        channel: NotificationChannel.IN_APP,
        referenceId: sparId,
        referenceType: "spar_room",
        payload: { sparName: spar.name },
      });
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
  // Observers without host flag are blocked
  if (role === "observer" && !member.is_host) throw new PermissionDeniedError("Observers cannot access evaluation data.");

  const evaluation = await getEvaluationBySparId(pool, sparId);
  const ballotSubmitted = evaluation?.status === "submitted";

  // HOST BRANCH
  if (member.is_host) {
    if (spar.status === "evaluating") {
      return { status: "evaluating", ballotSubmitted };
    }
    if (spar.status === "done" && ballotSubmitted) {
      const feedbacks = evaluation!.feedbacksJson ?? [];
      const sanitizedFeedbacks = feedbacks.map((f: FeedbackEntry) => {
        const rating = typeof f.rating === "string" ? parseFloat(f.rating) : f.rating;
        if (f.isAnonymous) {
          return { sparId, rating, comment: f.comment, isAnonymous: true, createdAt: f.createdAt };
        }
        return { ...f, rating };
      });
      return {
        status: "complete",
        ballotSubmitted: true,
        feedbacks: sanitizedFeedbacks,
        ballot: {
          sparId: evaluation!.sparId,
          judgeId: evaluation!.judgeId,
          resultsJson: evaluation!.resultsJson,
          placementsJson: evaluation!.placementsJson,
          createdAt: evaluation!.updatedAt,
        },
      };
    }
    // done but no ballot — judge never submitted during evaluation phase
    return { status: "disabled", message: "The evaluation phase ended without a submitted ballot." };
  }

  // DEBATER BRANCH
  if (role === "debater") {
    const feedbackSubmitted = evaluation
      ? evaluation.feedbacksJson.some((f: FeedbackEntry) => f.debaterId === userId)
      : false;

    if (ballotSubmitted) {
      return {
        status: "complete",
        ballot: {
          sparId: evaluation!.sparId,
          judgeId: evaluation!.judgeId,
          resultsJson: evaluation!.resultsJson,
          placementsJson: evaluation!.placementsJson,
          createdAt: evaluation!.updatedAt,
        },
        feedbackSubmitted,
      };
    }

    if (spar.status === "done") {
      // Final done with no ballot means judge never submitted
      return { status: "draw", message: "The judge did not submit a ballot. The match is scored as a draw." };
    }

    // evaluating — waiting for judge
    return {
      status: "pending",
      message: "Waiting for the judge to submit the ballot.",
      feedbackSubmitted,
    };
  }

  // JUDGE BRANCH
  if (role === "judge") {
    if (ballotSubmitted) {
      const feedbacks = evaluation!.feedbacksJson ?? [];
      const sanitizedFeedbacks = feedbacks.map((f: FeedbackEntry) => {
        const rating = typeof f.rating === "string" ? parseFloat(f.rating) : f.rating;
        if (f.isAnonymous) {
          return { sparId, rating, comment: f.comment, isAnonymous: true, createdAt: f.createdAt };
        }
        return { ...f, rating };
      });
      return {
        status: "complete",
        feedbacks: sanitizedFeedbacks,
        ballot: {
          sparId: evaluation!.sparId,
          judgeId: evaluation!.judgeId,
          resultsJson: evaluation!.resultsJson,
          placementsJson: evaluation!.placementsJson,
          createdAt: evaluation!.updatedAt,
        },
      };
    }

    if (spar.status === "done") {
      return { status: "disabled", message: "The evaluation phase has ended without a submitted ballot." };
    }

    // evaluating — ballot not yet submitted
    return { status: "pending", message: "Submit your ballot to unlock debater feedback." };
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
