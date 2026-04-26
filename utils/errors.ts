import { Response } from "express";

export enum ErrorCode {
  INVALID_FIELD_VALUE = "INVALID_FIELD_VALUE",
  MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
  SERVER_ERROR = "SERVER_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED",
  VERIFICATION_TOKEN_INVALID = "VERIFICATION_TOKEN_INVALID",
  VERIFICATION_TOKEN_EXPIRED = "VERIFICATION_TOKEN_EXPIRED",
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
