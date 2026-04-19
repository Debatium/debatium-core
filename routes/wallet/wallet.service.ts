import { v4 as uuidv4 } from "uuid";
import { getPool } from "../../extensions/db.js";
import { payOS } from "../../utils/payos.js";
import { insertTransaction, getTransactionByOrderCode, updateTransactionStatus, getTransactionsByUserId } from "../../db/transactions/queries.js";
import {
  TransactionType,
  TransactionStatus,
  Transaction,
} from "../../db/transactions/domain.js";
import { getUserBalances, recordTopUpSuccess, getUserBankInfo, updateBankInfo as updateBankInfoQuery, moveToPendingWithdrawal, deductPendingWithdrawal, getUserById } from "../../db/users/queries.js";
import { insertWithdrawalRequest, getWithdrawalsByUserId, getWithdrawalById, updateWithdrawalStatus as updateWithdrawalStatusQuery } from "../../db/withdrawals/queries.js";
import { WithdrawalStatus, type WithdrawalRequest } from "../../db/withdrawals/domain.js";
import { DomainValidationError } from "../../db/exceptions.js";
import { createNotification } from "../notifications/notifications.services.js";
import { NotificationEventType, NotificationChannel } from "../../db/notifications/domain.js";
import { sendWithdrawalCompletedEmail } from "../../extensions/email.js";

const PACKAGES = {
  PKG_50: { coins: 50, price: 50000 },
  PKG_100: { coins: 100, price: 100000 },
  PKG_200: { coins: 220, price: 200000 },
  PKG_500: { coins: 575, price: 500000 },
};

const MIN_WITHDRAWAL = 10;
const COIN_TO_VND = 1000;

export async function createTopUpService(
  userId: string,
  packageId: string,
): Promise<string> {
  const pkg = PACKAGES[packageId as keyof typeof PACKAGES];
  if (!pkg) throw new DomainValidationError("Invalid package ID");

  const orderCode = Number(String(Date.now()).slice(-6));
  const now = new Date();

  // Webhook expects a 15-minute expiration
  const expiredAt = Math.floor(now.getTime() / 1000) + 15 * 60;

  const body = {
    orderCode,
    amount: pkg.price,
    description: `Top up ${pkg.coins} coins`,
    items: [
      {
        name: `Gói ${pkg.coins} Coins`,
        quantity: 1,
        price: pkg.price,
      },
    ],
    cancelUrl: process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/coins/cancel`
      : `http://localhost:5173/coins/cancel`,
    returnUrl: process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/coins/success`
      : `http://localhost:5173/coins/success`,
    expiredAt,
  };

  const paymentLinkRes = await payOS.paymentRequests.create(body);

  const transaction: Transaction = {
    id: uuidv4(),
    userId,
    type: TransactionType.TOP_UP,
    status: TransactionStatus.PENDING,
    amountCoin: pkg.coins,
    amountVnd: pkg.price,
    orderCode,
    checkoutUrl: paymentLinkRes.checkoutUrl,
    createdAt: now,
    updatedAt: now,
  };

  const pool = getPool();
  await insertTransaction(pool, transaction);

  return paymentLinkRes.checkoutUrl;
}

export async function getUserBalancesService(userId: string) {
  const pool = getPool();
  const balances = await getUserBalances(pool, userId);
  return balances || { availableBalance: 0, frozenBalance: 0, pendingWithdrawal: 0 };
}

export async function syncTransactionStatusService(userId: string, orderCode: number) {
  const pool = getPool();
  const transaction = await getTransactionByOrderCode(pool, orderCode);

  if (!transaction || transaction.userId !== userId) {
    throw new DomainValidationError("Transaction not found or unauthorized");
  }

  // If already processed (success/cancelled/failed), return current state
  if (transaction.status !== TransactionStatus.PENDING) {
    return { transaction, payosInfo: null };
  }

  // Attempt to sync/fetch live status from PayOS
  let payosInfo = null;
  try {
    payosInfo = await payOS.paymentRequests.get(orderCode);
  } catch (err) {
    console.error("Failed to fetch live PayOS status:", err);
    return { transaction, payosInfo: null };
  }

  // Business Logic: If PayOS says it's PAID but we haven't recorded it yet
  if (payosInfo.status === "PAID") {
    await fulfillTransactionService(orderCode);
    transaction.status = TransactionStatus.SUCCESS;
  } 
  // If PayOS says it's CANCELLED
  else if (payosInfo.status === "CANCELLED") {
    await cancelTransactionService(orderCode);
    transaction.status = TransactionStatus.CANCELLED;
  }

  return {
    transaction,
    payosInfo
  };
}

export async function getTransactionStatusService(userId: string, orderCode: number) {
  return syncTransactionStatusService(userId, orderCode);
}

export async function getTransactionHistoryService(userId: string) {
  const pool = getPool();
  return getTransactionsByUserId(pool, userId);
}

export async function fulfillTransactionService(orderCode: number): Promise<boolean> {
  const pool = getPool();
  const transaction = await getTransactionByOrderCode(pool, orderCode);

  if (transaction && transaction.status === TransactionStatus.PENDING) {
    await updateTransactionStatus(pool, orderCode, TransactionStatus.SUCCESS);
    await recordTopUpSuccess(pool, transaction.userId, transaction.amountCoin);
    return true;
  }
  return false;
}

export async function cancelTransactionService(orderCode: number): Promise<boolean> {
  const pool = getPool();
  const transaction = await getTransactionByOrderCode(pool, orderCode);

  if (transaction && transaction.status === TransactionStatus.PENDING) {
    await updateTransactionStatus(pool, orderCode, TransactionStatus.CANCELLED);
    return true;
  }
  return false;
}

// ── Withdrawal Services ──

export async function requestWithdrawalService(userId: string, amountCoin: number) {
  if (!Number.isFinite(amountCoin) || amountCoin < MIN_WITHDRAWAL) {
    throw new DomainValidationError(`Minimum withdrawal is ${MIN_WITHDRAWAL} coins`);
  }

  const pool = getPool();

  // Validate bank info
  const bankInfo = await getUserBankInfo(pool, userId);
  if (!bankInfo || !bankInfo.bankName || !bankInfo.bankAccountNumber || !bankInfo.bankAccountHolder) {
    throw new DomainValidationError("Bank information is required before withdrawing");
  }

  const amountVnd = amountCoin * COIN_TO_VND;
  const now = new Date();
  const idempotencyKey = uuidv4();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Move coins from available to pending_withdrawal
    await moveToPendingWithdrawal(client, userId, amountCoin);

    // Create withdrawal request
    const withdrawalRequest: WithdrawalRequest = {
      id: uuidv4(),
      userId,
      amountCoin,
      amountVnd,
      status: WithdrawalStatus.PENDING,
      idempotencyKey,
      bankName: bankInfo.bankName,
      bankAccountNumber: bankInfo.bankAccountNumber,
      bankAccountHolder: bankInfo.bankAccountHolder,
      createdAt: now,
      updatedAt: now,
    };
    await insertWithdrawalRequest(client, withdrawalRequest);

    // Record a withdrawal transaction
    const transaction: Transaction = {
      id: uuidv4(),
      userId,
      type: TransactionType.WITHDRAWAL,
      status: TransactionStatus.PENDING,
      amountCoin,
      amountVnd,
      orderCode: null,
      checkoutUrl: null,
      createdAt: now,
      updatedAt: now,
    };
    await insertTransaction(client, transaction);

    await client.query("COMMIT");
    return withdrawalRequest;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getWithdrawalsService(userId: string) {
  const pool = getPool();
  return getWithdrawalsByUserId(pool, userId);
}

export async function getBankInfoService(userId: string) {
  const pool = getPool();
  const info = await getUserBankInfo(pool, userId);
  return info || { bankName: null, bankAccountNumber: null, bankAccountHolder: null };
}

export async function updateBankInfoService(
  userId: string,
  bankName: string,
  bankAccountNumber: string,
  bankAccountHolder: string
) {
  if (!bankName || !bankAccountNumber || !bankAccountHolder) {
    throw new DomainValidationError("All bank info fields are required");
  }
  const pool = getPool();
  await updateBankInfoQuery(pool, userId, bankName, bankAccountNumber, bankAccountHolder);
  return { bankName, bankAccountNumber, bankAccountHolder };
}

/**
 * Admin confirms a withdrawal has been paid. This:
 * 1. Deducts pending_withdrawal from the user's balance
 * 2. Updates the withdrawal request status to "completed"
 * 3. Sends in-app notification + email to the user
 */
export async function confirmWithdrawalService(withdrawalId: string) {
  const pool = getPool();
  const withdrawal = await getWithdrawalById(pool, withdrawalId);

  if (!withdrawal) {
    throw new DomainValidationError("Withdrawal request not found");
  }
  if (withdrawal.status !== WithdrawalStatus.PENDING) {
    throw new DomainValidationError("Withdrawal has already been processed");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Deduct pending_withdrawal permanently
    await deductPendingWithdrawal(client, withdrawal.userId, withdrawal.amountCoin);

    // 2. Mark withdrawal as completed
    await updateWithdrawalStatusQuery(client, withdrawalId, WithdrawalStatus.COMPLETED);

    // 3. Send in-app notification
    await createNotification(client, {
      customerId: withdrawal.userId,
      eventType: NotificationEventType.WITHDRAWAL_COMPLETED,
      channel: NotificationChannel.IN_APP,
      referenceId: withdrawalId,
      referenceType: "withdrawal",
      payload: {
        amountCoin: withdrawal.amountCoin,
        amountVnd: withdrawal.amountVnd,
      },
    });

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // 4. Send email asynchronously (outside transaction — non-critical)
  const user = await getUserById(pool, withdrawal.userId);
  if (user) {
    sendWithdrawalCompletedEmail(
      user.email,
      user.fullName,
      withdrawal.amountCoin,
      withdrawal.amountVnd
    ).catch(() => {}); // fire-and-forget
  }

  return { ...withdrawal, status: WithdrawalStatus.COMPLETED };
}
