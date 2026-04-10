import { DomainValidationError } from "../exceptions.js";
import { TournamentRule } from "../tournaments/domain.js";

export interface BallotSpeaker {
  userId: string;
  score: number;
  reason?: string;
}

export class BallotPayload {
  constructor(
    public sparId: string,
    public format: TournamentRule,
    public teams: Record<string, BallotSpeaker[]>,
    public replySpeeches?: Record<string, BallotSpeaker>
  ) {
    this.validateStructure();
    this.validateScores();
  }

  private validateStructure() {
    const teamKeys = Object.keys(this.teams);
    const teamCount = teamKeys.length;

    // Validate team keys and count per format
    const BP_TEAMS = ["OG", "OO", "CG", "CO"];
    const WSDC_TEAMS = ["Proposition", "Opposition"];

    if (this.format === TournamentRule.BP) {
      if (teamCount !== 4) {
        throw new DomainValidationError(`BP format requires exactly 4 teams, got ${teamCount}`);
      }
      const invalidKeys = teamKeys.filter((k) => !BP_TEAMS.includes(k));
      if (invalidKeys.length > 0) {
        throw new DomainValidationError(`Invalid BP team keys: ${invalidKeys.join(", ")}. Must be: ${BP_TEAMS.join(", ")}`);
      }
      // BP: each team must have exactly 2 speakers
      for (const [team, speakers] of Object.entries(this.teams)) {
        if (speakers.length !== 2) {
          throw new DomainValidationError(`BP team ${team} must have exactly 2 speakers, got ${speakers.length}`);
        }
      }
    }

    if (this.format === TournamentRule.WSDC) {
      if (teamCount !== 2) {
        throw new DomainValidationError(`WSDC format requires exactly 2 teams, got ${teamCount}`);
      }
      const invalidKeys = teamKeys.filter((k) => !WSDC_TEAMS.includes(k));
      if (invalidKeys.length > 0) {
        throw new DomainValidationError(`Invalid WSDC team keys: ${invalidKeys.join(", ")}. Must be: ${WSDC_TEAMS.join(", ")}`);
      }
      // WSDC: each team must have exactly 3 speakers
      for (const [team, speakers] of Object.entries(this.teams)) {
        if (speakers.length !== 3) {
          throw new DomainValidationError(`WSDC team ${team} must have exactly 3 speakers, got ${speakers.length}`);
        }
      }
    }

    // replySpeeches are only valid for WSDC (and optional)
    if (this.replySpeeches && this.format === TournamentRule.BP) {
      throw new DomainValidationError("Reply speeches are not applicable in BP format");
    }

    // No userId may appear more than once across all teams
    const allUserIds: string[] = Object.values(this.teams).flat().map((s) => s.userId);
    const uniqueIds = new Set(allUserIds);
    if (uniqueIds.size !== allUserIds.length) {
      throw new DomainValidationError("Duplicate userId found across teams");
    }
  }

  private validateScores() {
    // Use integer arithmetic to avoid IEEE 754 floating-point errors.
    // A valid score must be a multiple of 0.5, i.e. (score * 10) % 5 === 0.
    const isValidIncrement = (score: number) => Math.round(score * 10) % 5 === 0;

    for (const speakers of Object.values(this.teams)) {
      for (const speaker of speakers) {
        if (speaker.score < 60 || speaker.score > 80) {
          throw new DomainValidationError(`Score out of bounds for user ${speaker.userId}. Must be 60–80.`);
        }
        if (!isValidIncrement(speaker.score)) {
          throw new DomainValidationError(`Score must be in 0.5 increments for user ${speaker.userId}`);
        }
      }
    }

    if (this.replySpeeches) {
      for (const reply of Object.values(this.replySpeeches)) {
        if (reply.score < 30 || reply.score > 40) {
          throw new DomainValidationError(`Reply score out of bounds for user ${reply.userId}. Must be 30–40.`);
        }
        if (!isValidIncrement(reply.score)) {
          throw new DomainValidationError(`Reply score must be in 0.5 increments for user ${reply.userId}`);
        }
      }
    }
  }
}

export class FeedbackPayload {
  constructor(
    public sparId: string,
    public rating: number,
    public comment: string | undefined, // optional — debater may omit
    public isAnonymous: boolean
  ) {
    const isValidIncrement = (n: number) => Math.round(n * 10) % 5 === 0;
    if (rating < 1 || rating > 10 || !isValidIncrement(rating)) {
      throw new DomainValidationError("Rating must be between 1 and 10 and in 0.5 increments.");
    }
    if (comment && comment.length > 300) {
      throw new DomainValidationError("Comment must be 300 characters or fewer.");
    }
  }
}

export type EvaluationStatus = "pending" | "submitted";

export interface FeedbackEntry {
  debaterId: string;
  rating: number;
  comment: string | null;
  isAnonymous: boolean;
  createdAt: string;
}

export interface Evaluation {
  sparId: string;
  judgeId: string;
  status: EvaluationStatus;
  resultsJson: any | null;
  placementsJson: any | null;
  feedbacksJson: FeedbackEntry[];
  createdAt: Date;
  updatedAt: Date;
}
