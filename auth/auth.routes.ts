import { Router, Request, Response, NextFunction } from "express";
import { validateJson } from "../middleware/validateJson.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { ErrorCode, errorResponse } from "../utils/errors.js";
import { loginService, logoutService, SESSION_EXPIRATION_SECONDS } from "./auth.services.js";

export function createAuthRouter(isProd: boolean): Router {
  const router = Router();

  router.post(
    "/login",
    validateJson(["email", "password"]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { email, password } = req.body;

        if (!email || !password) {
          errorResponse(res, 400, ErrorCode.MISSING_REQUIRED_FIELD, "Email and password are required");
          return;
        }

        const sessionId = await loginService(email, password);

        res.cookie("id", sessionId, {
          httpOnly: true,
          secure: isProd,
          sameSite: isProd ? "strict" : "lax",
          maxAge: SESSION_EXPIRATION_SECONDS * 1000,
        });

        res.status(200).json({ message: "Successfully logged in" });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/logout",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sessionId = req.cookies?.id;
        await logoutService(sessionId);

        res.cookie("id", "", {
          expires: new Date(0),
          maxAge: 0,
          httpOnly: true,
          secure: isProd,
          sameSite: isProd ? "strict" : "lax",
        });

        res.status(200).json({ message: "Successfully logged out" });
      } catch (err) {
        next(err);
      }
    }
  );

  // Error handler for auth routes
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValueError) {
      errorResponse(res, 400, ErrorCode.INVALID_FIELD_VALUE, err.message);
      return;
    }
    _next(err);
  });

  return router;
}

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}
