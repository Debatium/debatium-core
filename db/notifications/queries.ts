import type pg from "pg";
import type { Notification } from "./domain.js";

type DbClient = pg.Pool | pg.PoolClient;

export async function insertNotification(
  pool: DbClient,
  data: {
    customerId: string;
    eventType: string;
    channel: string;
    referenceId: string | null;
    referenceType: string | null;
    payload: Record<string, unknown>;
    status: string;
  }
): Promise<string | null> {
  const { rows } = await pool.query(
    `INSERT INTO notifications (customer_id, event_type, channel, reference_id, reference_type, payload, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [data.customerId, data.eventType, data.channel, data.referenceId, data.referenceType, JSON.stringify(data.payload), data.status]
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}

export async function getNotifications(
  pool: DbClient,
  customerId: string,
  limit: number,
  offset: number
): Promise<Notification[]> {
  const { rows } = await pool.query(
    `SELECT id, event_type, reference_id, reference_type, payload, status, created_at, read_at
     FROM notifications
     WHERE customer_id = $1 AND channel = 'in-app'
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [customerId, limit, offset]
  );
  return rows.map((r) => ({
    id: String(r.id),
    eventType: r.event_type,
    referenceId: r.reference_id ? String(r.reference_id) : null,
    referenceType: r.reference_type,
    payload: r.payload,
    status: r.status,
    createdAt: r.created_at?.toISOString() ?? null,
    readAt: r.read_at?.toISOString() ?? null,
  }));
}

export async function markNotificationRead(
  pool: DbClient,
  notificationId: string,
  customerId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = NOW(), status = 'read'
     WHERE id = $1 AND customer_id = $2 AND read_at IS NULL`,
    [notificationId, customerId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getUnreadCount(
  pool: DbClient,
  customerId: string
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM notifications
     WHERE customer_id = $1 AND channel = 'in-app' AND read_at IS NULL`,
    [customerId]
  );
  return rows[0]?.count ?? 0;
}

export async function sparExists(
  pool: DbClient,
  sparId: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM spars WHERE id = $1`,
    [sparId]
  );
  return rows.length > 0;
}
