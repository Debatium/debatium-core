import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { ErrorCode } from "../utils/errors.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(_isProd: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let token = req.cookies.accessToken;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }

    if (!token) {
      res.status(401).json({
        error: { code: ErrorCode.UNAUTHORIZED, message: "Missing authentication token" },
      });
      return;
    }

    try {
      const payload = verifyAccessToken(token);
      req.userId = payload.userId;
      next();
    } catch {
      res.status(401).json({
        error: { code: ErrorCode.UNAUTHORIZED, message: "Invalid or expired token" },
      });
    }
  };
}
