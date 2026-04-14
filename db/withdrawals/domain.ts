export enum WithdrawalStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  REJECTED = "rejected",
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  amountCoin: number;
  amountVnd: number;
  status: WithdrawalStatus;
  idempotencyKey: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  createdAt: Date;
  updatedAt: Date;
}
