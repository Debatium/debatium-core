import { Request, Response, NextFunction } from "express";

export function corsMiddleware(isProd: boolean) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const origin = isProd
      ? "https://debatium.org"
      : "http://localhost:3000";

    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");

    next();
  };
}
