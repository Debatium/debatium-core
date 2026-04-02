import { Request, Response, NextFunction } from "express";
import { ErrorCode, errorResponse } from "../utils/errors.js";

export function validateRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 1. Validate payload size (2MB limit)
  const contentLength = req.headers["content-length"];
  if (contentLength && parseInt(contentLength, 10) > 2 * 1024 * 1024) {
    errorResponse(
      res,
      413,
      ErrorCode.SERVER_ERROR,
      "Payload too large. Maximum size is 2MB"
    );
    return;
  }

  // 2. Only validate JSON for methods that typically have a body
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const contentType = req.headers["content-type"] || "";

    if (req.body && Object.keys(req.body).length > 0 && !contentType.includes("application/json")) {
      errorResponse(
        res,
        415,
        ErrorCode.INVALID_FIELD_VALUE,
        "Content-Type must be application/json"
      );
      return;
    }

    if (contentType.includes("charset=") && !contentType.toLowerCase().includes("utf-8")) {
      errorResponse(
        res,
        415,
        ErrorCode.INVALID_FIELD_VALUE,
        "Invalid charset. Only UTF-8 is supported"
      );
      return;
    }
  }

  next();
}
