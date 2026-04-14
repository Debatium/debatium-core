import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { createTopUpService, getUserBalancesService, getTransactionStatusService } from "./wallet.service.js";

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

  return router;
}
