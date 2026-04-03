import { Request, Response, NextFunction } from "express";

const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
];

export function corsMiddleware(isProd: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestOrigin = req.headers.origin ?? "";

    const origin = isProd
      ? "https://debatium.org"
      : DEV_ORIGINS.includes(requestOrigin) ? requestOrigin : DEV_ORIGINS[0];

    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  };
}
