import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { errorResponse } from "../../utils/errors.js";
import { DomainValidationError } from "../../db/exceptions.js";
import {
  submitBallotService,
  submitFeedbackService,
  getEvaluationDataService,
} from "./evaluation.services.js";

export function createEvaluationRouter(isProd: boolean): Router {
  const router = Router();

  // POST /evaluations/ballot — Submit ballot (Judge)
  router.post(
    "/ballot",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await submitBallotService(req.userId!, req.body);
        res.status(200).json({ message: "Ballot submitted successfully" });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /evaluations/feedback — Submit feedback (Debater)
  router.post(
    "/feedback",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await submitFeedbackService(req.userId!, req.body);
        res.status(200).json({ message: "Feedback submitted successfully" });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /evaluations — Fetch evaluation data (Blind Reveal)
  router.get(
    "/",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sparId = req.query.sparId as string;
        if (!sparId) throw new DomainValidationError("sparId query parameter is required");
        const data = await getEvaluationDataService(req.userId!, sparId);
        res.status(200).json(data);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
