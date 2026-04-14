import type pg from "pg";
import type { WithdrawalRequest } from "./domain.js";

type DbClient = pg.Pool | pg.PoolClient;

function mapRow(r: Record<string, unknown>): WithdrawalRequest {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    amountCoin: Number(r.amount_coin),
    amountVnd: Number(r.amount_vnd),
    status: r.status as WithdrawalRequest["status"],
    idempotencyKey: String(r.idempotency_key),
    bankName: String(r.bank_name),
    bankAccountNumber: String(r.bank_account_number),
    bankAccountHolder: String(r.bank_account_holder),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

export async function insertWithdrawalRequest(
  pool: DbClient,
  req: WithdrawalRequest
): Promise<void> {
  await pool.query(
    `INSERT INTO withdrawal_requests (
      id, user_id, amount_coin, amount_vnd, status, idempotency_key,
      bank_name, bank_account_number, bank_account_holder, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      req.id,
      req.userId,
      req.amountCoin,
      req.amountVnd,
      req.status,
      req.idempotencyKey,
      req.bankName,
      req.bankAccountNumber,
      req.bankAccountHolder,
      req.createdAt,
      req.updatedAt,
    ]
  );
}

export async function getWithdrawalsByUserId(
  pool: DbClient,
  userId: string
): Promise<WithdrawalRequest[]> {
  const { rows } = await pool.query(
    `SELECT id, user_id, amount_coin, amount_vnd, status, idempotency_key,
            bank_name, bank_account_number, bank_account_holder, created_at, updated_at
     FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(mapRow);
}
