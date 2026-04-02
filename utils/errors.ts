import { Response } from "express";

export enum ErrorCode {
  INVALID_FIELD_VALUE = "INVALID_FIELD_VALUE",
  MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
  SERVER_ERROR = "SERVER_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
}

export function errorResponse(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string
): Response {
  return res.status(status).json({
    error: { code, message },
  });
}
