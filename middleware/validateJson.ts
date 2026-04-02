import { Request, Response, NextFunction } from "express";
import { ErrorCode, errorResponse } from "../utils/errors.js";

export function validateJson(expectedKeys: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const data = req.body;

    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      errorResponse(
        res,
        400,
        ErrorCode.INVALID_FIELD_VALUE,
        "JSON body is required"
      );
      return;
    }

    const extraKeys = Object.keys(data).filter(
      (key) => !expectedKeys.includes(key)
    );
    if (extraKeys.length > 0) {
      errorResponse(
        res,
        400,
        ErrorCode.INVALID_FIELD_VALUE,
        "too many keys"
      );
      return;
    }

    next();
  };
}
