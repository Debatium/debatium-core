export enum SparStatus {
  CREATED = "created",
  MATCHING = "matching",
  READY = "ready",
  DEBATING = "debating",
  DONE = "done",
  CANCELLED = "cancelled",
}

export enum SparRole {
  DEBATER = "debater",
  JUDGE = "judge",
  OBSERVER = "observer",
}

export enum RequestStatus {
  PENDING = "pending",
  ACCEPTED = "accepted",
  DECLINED = "declined",
  INVITED = "invited",
}

export interface SparMemberDetails {
  userId: string;
  fullName: string;
  username: string;
  avatarURL: number | string;
  judgeLevel: string;
  debaterLevel: string;
  role: string;
  isHost: boolean;
  status: string;
}

export interface SparWithMembers {
  id: string;
  name: string;
  time: string;
  rule: string;
  status: string;
  expectedDebaterLevel: string;
  expectedJudgeLevel: string | null;
  expectingJudge: boolean;
  motion: string | null;
  meetLink: string | null;
  prepLinks: { team: string; link: string }[];
  members: SparMemberDetails[];
  isHost: boolean | null;
  notifications: SparMemberDetails[] | null;
  memberCount?: number;
}
