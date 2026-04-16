import { DomainValidationError } from "../exceptions.js";
import { TournamentRule } from "../tournaments/domain.js";

// ── Enums ──

export enum UserRole {
  USER = "user",
  ADMIN = "admin",
}

export enum DebaterLevel {
  NOVICE = "novice",
  OPEN = "open",
  PRO = "pro",
}

export enum JudgeLevel {
  NOVICE = "novice",
  INTERMEDIATE = "intermediate",
  ADVANCED = "advanced",
  EXPERT = "expert",
}

// ── Value Objects ──

export class FullName {
  readonly value: string;
  constructor(raw: string) {
    const val = raw?.trim() ?? "";
    if (!val) throw new DomainValidationError("Full name cannot be empty");
    this.value = val;
  }
}

export class Username {
  readonly value: string;
  constructor(raw: string) {
    const val = raw?.trim() ?? "";
    if (val.length < 3 || val.length > 50) {
      throw new DomainValidationError("Username must be between 3 and 50 characters");
    }
    if (!/^[a-zA-Z0-9_]+$/.test(val)) {
      throw new DomainValidationError("Username can only contain alphanumeric characters and underscores");
    }
    this.value = val;
  }
}

export class Password {
  readonly value: string;
  constructor(raw: string) {
    if (!raw) throw new DomainValidationError("Password cannot be empty");
    if (raw.length < 8) throw new DomainValidationError("Password must be at least 8 characters long");
    if (raw.length > 500) throw new DomainValidationError("Password length too long");
    this.value = raw;
  }
}

export class Email {
  readonly value: string;
  constructor(raw: string) {
    const val = raw?.trim() ?? "";
    if (!val || !val.includes("@") || !val.split("@").pop()?.includes(".")) {
      throw new DomainValidationError("Invalid email format");
    }
    if (val.length > 500) throw new DomainValidationError("Email length too long");
    this.value = val;
  }
}

export class Institution {
  readonly value: string | null;
  constructor(raw: string | null | undefined) {
    this.value = raw?.trim() || null;
  }
}

export class AvatarURL {
  readonly value: number;
  constructor(raw: number) {
    if (raw < 1 || raw > 10) throw new DomainValidationError("Avatar URL must be between 1 and 10");
    this.value = raw;
  }
}

// ── Entities ──

export interface User {
  id: string;
  fullName: FullName;
  username: Username;
  passwordHash: string;
  email: Email;
  role: UserRole;
  debaterLevel: DebaterLevel;
  judgeLevel: JudgeLevel;
  debaterScore: number;
  judgeScore: number;
  institution: Institution | null;
  avatarUrl: AvatarURL;
  calendarKey: string | null;
}

// ── Availability ──

export class CustomDateTime {
  readonly value: Date;

  private constructor(date: Date) {
    this.value = date;
  }

  static fromStr(dateStr: string): CustomDateTime {
    // Expected format: DD/MM/YYYY HH:MM
    const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
    if (!match) {
      throw new DomainValidationError("Date format must be exactly DD/MM/YYYY HH:MM (e.g., 10/03/2026 12:00)");
    }
    const [, day, month, year, hour, minute] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    if (isNaN(date.getTime())) {
      throw new DomainValidationError("Date format must be exactly DD/MM/YYYY HH:MM (e.g., 10/03/2026 12:00)");
    }
    if (date < new Date()) {
      throw new DomainValidationError("Time cannot be in the past");
    }
    return new CustomDateTime(date);
  }

  toStr(): string {
    const d = this.value;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

export class AvailabilityRole {
  readonly value: string;
  constructor(raw: string) {
    if (raw !== "debater" && raw !== "judge") {
      throw new DomainValidationError("Role must be 'debater' or 'judge'");
    }
    this.value = raw;
  }
}

export interface UserAvailability {
  id: string;
  userId: string;
  name: string;
  startTime: CustomDateTime;
  endTime: CustomDateTime;
  format: TournamentRule;
  expectedJudgeLevel: JudgeLevel | null;
  expectedDebaterLevel: DebaterLevel | null;
  roles: AvailabilityRole[];
}

export function validateAvailability(a: UserAvailability): void {
  if (!a.name || !a.name.trim()) {
    throw new DomainValidationError("Availability name cannot be empty");
  }
  if (a.startTime.value >= a.endTime.value) {
    throw new DomainValidationError("Start time must be before end time");
  }
  if (!a.roles.length) {
    throw new DomainValidationError("Roles must contain at least one role (e.g. debater or judge)");
  }
}
