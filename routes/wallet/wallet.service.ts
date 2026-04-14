import { v4 as uuidv4 } from "uuid";
import { getPool } from "../../extensions/db.js";
import { payOS } from "../../utils/payos.js";
import { insertTransaction, getTransactionByOrderCode, updateTransactionStatus } from "../../db/transactions/queries.js";
import {
  TransactionType,
  TransactionStatus,
  Transaction,
} from "../../db/transactions/domain.js";
import { getUserBalances, recordTopUpSuccess } from "../../db/users/queries.js";
import { DomainValidationError } from "../../db/exceptions.js";

const PACKAGES = {
  PKG_50: { coins: 50, price: 50000 },
  PKG_100: { coins: 100, price: 100000 },
  PKG_200: { coins: 220, price: 200000 },
  PKG_500: { coins: 575, price: 500000 },
};

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
      ? `${process.env.FRONTEND_URL}/wallet/cancel`
      : `http://localhost:5173/wallet/cancel`,
    returnUrl: process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/wallet/success`
      : `http://localhost:5173/wallet/success`,
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
  return balances || { availableBalance: 0, frozenBalance: 0 };
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
