import type pg from "pg";
import type { Transaction } from "./domain.js";

type DbClient = pg.Pool | pg.PoolClient;

export async function insertTransaction(
  pool: DbClient,
  transaction: Transaction
): Promise<void> {
  await pool.query(
    `INSERT INTO transactions (
      id, user_id, type, status, amount_coin, amount_vnd, order_code, checkout_url, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      transaction.id,
      transaction.userId,
      transaction.type,
      transaction.status,
      transaction.amountCoin,
      transaction.amountVnd,
      transaction.orderCode,
      transaction.checkoutUrl,
      transaction.createdAt,
      transaction.updatedAt
    ]
  );
}

export async function getTransactionByOrderCode(
  pool: DbClient,
  orderCode: number
): Promise<Transaction | null> {
  const { rows } = await pool.query(
    `SELECT id, user_id, type, status, amount_coin, amount_vnd, order_code, checkout_url, created_at, updated_at
     FROM transactions WHERE order_code = $1`,
    [orderCode]
  );

  if (!rows[0]) return null;
  const r = rows[0];

  return {
    id: String(r.id),
    userId: String(r.user_id),
    type: r.type,
    status: r.status,
    amountCoin: Number(r.amount_coin),
    amountVnd: r.amount_vnd ? Number(r.amount_vnd) : null,
    orderCode: r.order_code ? Number(r.order_code) : null,
    checkoutUrl: r.checkout_url,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at)
  };
}

export async function updateTransactionStatus(
  pool: DbClient,
  orderCode: number,
  status: string
): Promise<void> {
  await pool.query(
    `UPDATE transactions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE order_code = $2`,
    [status, orderCode]
  );
}

export async function getTransactionsByUserId(
  pool: DbClient,
  userId: string
): Promise<Transaction[]> {
  const { rows } = await pool.query(
    `SELECT id, user_id, type, status, amount_coin, amount_vnd, order_code, checkout_url, created_at, updated_at
     FROM transactions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    type: r.type,
    status: r.status,
    amountCoin: Number(r.amount_coin),
    amountVnd: r.amount_vnd ? Number(r.amount_vnd) : null,
    orderCode: r.order_code ? Number(r.order_code) : null,
    checkoutUrl: r.checkout_url,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at)
  }));
}
