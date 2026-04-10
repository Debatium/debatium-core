export enum NotificationEventType {
  INVITE_RECEIVED = "INVITE_RECEIVED",
  JOIN_REQUEST_RECEIVED = "JOIN_REQUEST_RECEIVED",
  REQUEST_DECISION = "REQUEST_DECISION",
  MEETING_READY = "MEETING_READY",
  SPAR_CANCELLED = "SPAR_CANCELLED",
  ASSIGNED_AS_HOST = "ASSIGNED_AS_HOST",
  REMOVED_FROM_SPAR = "REMOVED_FROM_SPAR",
  INVITATION_RESTORED = "INVITATION_RESTORED",
  BALLOT_SUBMITTED = "BALLOT_SUBMITTED",
  FEEDBACK_SUBMITTED = "FEEDBACK_SUBMITTED",
}

export enum NotificationChannel {
  IN_APP = "in-app",
  EMAIL = "email",
}

export enum NotificationStatus {
  PENDING = "pending",
  SENT = "sent",
  READ = "read",
  FAILED = "failed",
  SKIPPED = "skipped",
  CANCELLED = "cancelled",
}

export interface Notification {
  id: string;
  eventType: string;
  referenceId: string | null;
  referenceType: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  readAt: string | null;
}
