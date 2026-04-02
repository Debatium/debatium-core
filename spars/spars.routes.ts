import { Router, Request, Response, NextFunction } from "express";
import { ErrorCode, errorResponse } from "../utils/errors.js";

export function createSparsRouter(isProd: boolean): Router {
  const router = Router();

  // TODO: Add spar routes mirroring Debatium-backend/app/spars/routes.py

  // Error handler for spar routes
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err.name === "ValueError") {
      errorResponse(res, 400, ErrorCode.INVALID_FIELD_VALUE, err.message);
      return;
    }
    _next(err);
  });

  return router;
}
