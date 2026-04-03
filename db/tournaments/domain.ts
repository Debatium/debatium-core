import { DomainValidationError } from "../exceptions.js";

// ── Enums ──

export enum TournamentRule {
  BP = "bp",
  WSDC = "wsdc",
}

export enum EntryRole {
  DEBATER = "debater",
  INDEPENDENT_ADJUDICATOR = "independentAdjudicator",
  SUBSIDIZED_ADJUDICATOR = "subsidizedAdjudicator",
  INVITED_ADJUDICATOR = "invitedAdjudicator",
}

export enum JudgeRank {
  TRAINEE = "trainee",
  PANEL = "panel",
  CHAIR = "chair",
}

export enum AchievementEnum {
  PARTICIPANT = "participant",
  OCTO_FINALIST = "octoFinalist",
  QUARTER_FINALIST = "quarterFinalist",
  SEMI_FINALIST = "semiFinalist",
  FINALIST = "finalist",
  CHAMPION = "champion",
  RUNNER_UP = "runnerUp",
}

// ── Value Objects ──

export class TournamentName {
  readonly value: string;
  constructor(raw: string) {
    const val = raw?.trim() ?? "";
    if (!val) throw new DomainValidationError("Tournament name cannot be empty");
    if (val.length > 200) throw new DomainValidationError("Tournament name is too long");
    this.value = val;
  }
}

export class TournamentYear {
  readonly value: number;
  constructor(raw: number) {
    if (raw < 2000 || raw > 2100) throw new DomainValidationError("Invalid tournament year");
    this.value = raw;
  }
}

export class TournamentScale {
  readonly value: number;
  constructor(raw: number) {
    if (raw <= 0) throw new DomainValidationError("Tournament scale must be positive");
    this.value = raw;
  }
}

export class JudgeRounds {
  readonly value: number;
  constructor(raw: number) {
    if (raw < 1 || raw > 10) throw new DomainValidationError("Rounds must be between 1 and 10");
    this.value = raw;
  }
}

export class JudgeHighestRank {
  readonly value: string;
  constructor(raw: string) {
    const val = raw?.trim() ?? "";
    if (!val) throw new DomainValidationError("Highest rank cannot be empty");
    const allowed = Object.values(JudgeRank) as string[];
    if (!allowed.includes(val)) {
      throw new DomainValidationError(`Invalid judge rank. Must be one of: ${allowed.join(", ")}`);
    }
    this.value = val;
  }
}

export class BreakingRank {
  readonly value: number | null;
  constructor(raw: number | null) {
    if (raw !== null) {
      if (raw < 1 || raw > 16) throw new DomainValidationError("Breaking rank must be between 1 and 16");
    }
    this.value = raw;
  }
}

export class Achievement {
  readonly value: string | null;
  constructor(raw: string | null) {
    if (raw !== null) {
      const allowed = Object.values(AchievementEnum) as string[];
      if (!allowed.includes(raw)) {
        throw new DomainValidationError(`Invalid achievement. Must be one of: ${allowed.join(", ")}`);
      }
    }
    this.value = raw;
  }
}

// ── Entities ──

export interface Tournament {
  id: string;
  name: TournamentName;
  year: TournamentYear;
  scale: TournamentScale;
  rule: TournamentRule;
}

export interface JudgeDetails {
  id: string;
  rounds: JudgeRounds;
  highestRank: JudgeHighestRank;
}

export interface DebaterDetails {
  id: string;
  breakingRank: BreakingRank;
  achievement: Achievement;
}
