import { Request, Response, NextFunction } from "express";
import { getRedis } from "../extensions/redis.js";
import { ErrorCode } from "../utils/errors.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function clearCookieResponse(
  res: Response,
  message: string,
  isProd: boolean
): Response {
  res.cookie("id", "", {
    expires: new Date(0),
    maxAge: 0,
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "strict" : "lax",
  });

  return res.status(401).json({
    error: { code: ErrorCode.UNAUTHORIZED, message },
  });
}

export function requireAuth(isProd: boolean) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const sessionId = req.cookies?.id;

    if (!sessionId) {
      clearCookieResponse(res, "Missing authentication information", isProd);
      return;
    }

    const redis = getRedis();
    const userId = await redis.get<string>(sessionId);

    if (!userId) {
      clearCookieResponse(res, "Invalid or expired session", isProd);
      return;
    }

    req.userId = userId;
    next();
  };
}
