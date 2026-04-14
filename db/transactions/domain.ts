import { DomainValidationError } from "../exceptions.js";

export enum TransactionStatus {
  PENDING = "pending",
  SUCCESS = "success",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export enum TransactionType {
  TOP_UP = "top_up",
  FREEZE = "freeze",
  RELEASE = "release",
  REFUND = "refund",
  WITHDRAWAL = "withdrawal",
}

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  status: TransactionStatus;
  amountCoin: number;
  amountVnd: number | null;
  orderCode: number | null;
  checkoutUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
