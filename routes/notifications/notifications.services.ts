import type pg from "pg";
import { getPool } from "../../extensions/db.js";
import { getRedis } from "../../extensions/redis.js";
import { NotificationChannel, NotificationStatus } from "../../db/notifications/domain.js";
import { insertNotification, sparExists } from "../../db/notifications/queries.js";
import { sendSparInviteEmail } from "../../extensions/email.js";
import { createLogger } from "../../utils/logger.js";
import { getConfig } from "../../config.js";

const logger = createLogger(getConfig());

/**
 * Idempotency check via Redis. Returns true if event already processed (skip).
 */
async function checkIdempotency(eventType: string, referenceId: string, customerId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const unixMinute = Math.floor(Date.now() / 60000);
    const key = `idemp:${eventType}:${referenceId}:${customerId}:${unixMinute}`;
    const wasSet = await redis.setnx(key, "1");
    if (wasSet) {
      await redis.expire(key, 60);
      return false; // new event, proceed
    }
    return true; // already processed, skip
  } catch {
    return false; // redis unavailable, proceed anyway
  }
}

/**
 * Create an in-app and/or email notification. Mirrors the Python backend's create_notification.
 */
export async function createNotification(
  client: pg.Pool | pg.PoolClient,
  opts: {
    customerId: string;
    eventType: string;
    channel: NotificationChannel;
    referenceId: string | null;
    referenceType: string | null;
    payload: Record<string, unknown>;
    emailParams?: { toEmail: string; subject: string; htmlContent: string };
  }
): Promise<string | null> {
  // Idempotency
  if (opts.referenceId && await checkIdempotency(opts.eventType, opts.referenceId, opts.customerId)) {
    logger.info({ eventType: opts.eventType }, "Idempotent notification skipped");
    return null;
  }

  let status: string = NotificationStatus.PENDING;

  if (opts.channel === NotificationChannel.EMAIL && opts.emailParams) {
    // Validate spar still exists
    if (opts.referenceType === "spar_room" && opts.referenceId) {
      const exists = await sparExists(client, opts.referenceId);
      if (!exists) {
        status = NotificationStatus.CANCELLED;
        logger.info({ referenceId: opts.referenceId }, "Spar deleted, cancelling email notification");
      }
    }

    if (status !== NotificationStatus.CANCELLED) {
      try {
        const { getResend } = await import("../../extensions/resend.js");
        const resend = getResend();
        const config = getConfig();
        const from = config.isProd ? "Debatium <noreply@debatium.org>" : "Debatium <onboarding@resend.dev>";
        await resend.emails.send({
          from,
          to: opts.emailParams.toEmail,
          subject: opts.emailParams.subject,
          html: opts.emailParams.htmlContent,
        });
        status = NotificationStatus.SENT;
      } catch (err) {
        logger.error({ err }, "Failed to send notification email");
        status = NotificationStatus.FAILED;
      }
    }
  } else if (opts.channel === NotificationChannel.IN_APP) {
    status = NotificationStatus.SENT;
  }

  const notificationId = await insertNotification(client, {
    customerId: opts.customerId,
    eventType: opts.eventType,
    channel: opts.channel,
    referenceId: opts.referenceId,
    referenceType: opts.referenceType,
    payload: opts.payload,
    status,
  });

  logger.info({ notificationId, channel: opts.channel, eventType: opts.eventType }, "Notification created");
  return notificationId;
}

/**
 * Helper to create both in-app + email notifications for the same event.
 */
export async function notifyInAppAndEmail(
  client: pg.Pool | pg.PoolClient,
  opts: {
    customerId: string;
    eventType: string;
    referenceId: string;
    payload: Record<string, unknown>;
    email?: { toEmail: string; subject: string; htmlContent: string };
  }
): Promise<void> {
  // Always create in-app
  await createNotification(client, {
    customerId: opts.customerId,
    eventType: opts.eventType,
    channel: NotificationChannel.IN_APP,
    referenceId: opts.referenceId,
    referenceType: "spar_room",
    payload: opts.payload,
  });

  // Optionally create email
  if (opts.email) {
    await createNotification(client, {
      customerId: opts.customerId,
      eventType: opts.eventType,
      channel: NotificationChannel.EMAIL,
      referenceId: opts.referenceId,
      referenceType: "spar_room",
      payload: opts.payload,
      emailParams: opts.email,
    });
  }
}
