import { Router, Request, Response, NextFunction } from "express";
import { validateJson } from "../../middleware/validateJson.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { ErrorCode, errorResponse } from "../../utils/errors.js";
import { loginService, logoutService, refreshService, registerUserService } from "./auth.services.js";

export function createAuthRouter(isProd: boolean): Router {
  const router = Router();

  // POST /auth/register
  router.post(
    "/register",
    validateJson([
      "fullName", "username", "password", "email",
      "institution", "tournamentEntries", "avatarURL",
    ]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await registerUserService(req.body);
        res.status(201).json({ success: { message: "User has registered successfully" } });
      } catch (err) {
        const pgInfo = classifyPgError(err);
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // POST /auth/login — returns accessToken, refreshToken, user profile
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

        const result = await loginService(email, password);
        const { accessToken, refreshToken, user } = result;

        const isProduction = process.env.NODE_ENV === "production" || isProd;
        res.cookie("accessToken", accessToken, {
          httpOnly: true,
          secure: isProduction,
          sameSite: "lax",
          path: "/",
        });
        res.cookie("refreshToken", refreshToken, {
          httpOnly: true,
          secure: isProduction,
          sameSite: "lax",
          path: "/",
        });

        res.status(200).json({ user });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/refresh",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) {
          errorResponse(res, 401, ErrorCode.UNAUTHORIZED, "Refresh token is missing");
          return;
        }

        const result = await refreshService(refreshToken);
        const isProduction = process.env.NODE_ENV === "production" || isProd;
        res.cookie("accessToken", result.accessToken, {
          httpOnly: true,
          secure: isProduction,
          sameSite: "lax",
          path: "/",
        });

        res.status(200).json({ success: true });
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
        await logoutService(req.userId!);
        res.clearCookie("accessToken", { path: "/" });
        res.clearCookie("refreshToken", { path: "/" });
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

function classifyPgError(err: unknown): { code: ErrorCode; message: string; status: number } | null {
  const pgErr = err as { code?: string };
  if (!pgErr.code) return null;
  switch (pgErr.code) {
    case "23505": return { code: ErrorCode.INVALID_FIELD_VALUE, message: "Username or email is already taken.", status: 400 };
    case "23503": return { code: ErrorCode.INVALID_FIELD_VALUE, message: "A referenced record does not exist.", status: 400 };
    default:
      if (pgErr.code.startsWith("23")) return { code: ErrorCode.INVALID_FIELD_VALUE, message: "Something is invalid about your data.", status: 400 };
      return null;
  }
}
