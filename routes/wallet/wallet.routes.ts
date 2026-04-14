import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import {
  createTopUpService,
  getUserBalancesService,
  getTransactionStatusService,
  requestWithdrawalService,
  getWithdrawalsService,
  getBankInfoService,
  updateBankInfoService,
  confirmWithdrawalService,
} from "./wallet.service.js";

export function createWalletRouter(isProd: boolean): Router {
  const router = Router();

  router.post(
    "/top-up",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { packageId } = req.body;
        const checkoutUrl = await createTopUpService(req.userId!, packageId);
        res.status(200).json({ checkoutUrl });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/balance",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const balances = await getUserBalancesService(req.userId!);
        res.status(200).json(balances);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/transaction/:orderCode",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const orderCode = Number(req.params.orderCode);
        const status = await getTransactionStatusService(req.userId!, orderCode);
        res.status(200).json(status);
      } catch (err) {
        next(err);
      }
    }
  );

  // ── Withdrawal Endpoints ──

  router.post(
    "/withdraw",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { amountCoin } = req.body;
        const withdrawal = await requestWithdrawalService(req.userId!, Number(amountCoin));
        res.status(201).json(withdrawal);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/withdrawals",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const withdrawals = await getWithdrawalsService(req.userId!);
        res.status(200).json(withdrawals);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/bank-info",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const info = await getBankInfoService(req.userId!);
        res.status(200).json(info);
      } catch (err) {
        next(err);
      }
    }
  );

  router.put(
    "/bank-info",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { bankName, bankAccountNumber, bankAccountHolder } = req.body;
        const info = await updateBankInfoService(req.userId!, bankName, bankAccountNumber, bankAccountHolder);
        res.status(200).json(info);
      } catch (err) {
        next(err);
      }
    }
  );

  // ── Admin Endpoint ──

  router.post(
    "/confirm-withdrawal",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { withdrawalId } = req.body;
        const result = await confirmWithdrawalService(withdrawalId);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
