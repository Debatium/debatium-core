import { Request, Response, NextFunction } from "express";
import { ErrorCode } from "../utils/errors.js";

export function requireAdmin() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.userRole !== "admin") {
      res.status(403).json({
        error: { code: ErrorCode.FORBIDDEN, message: "Admin access required" },
      });
      return;
    }
    next();
  };
}
