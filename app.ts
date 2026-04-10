import express from "express";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import type { Request, Response, NextFunction } from "express";

import { getConfig, type AppConfig } from "./config.js";
import { initPool } from "./extensions/db.js";
import { initRedis } from "./extensions/redis.js";
import { initResend } from "./extensions/resend.js";
import { initJwt } from "./utils/jwt.js";
import { createLogger } from "./utils/logger.js";
import { validateRequest } from "./middleware/validateRequest.js";
import { corsMiddleware } from "./middleware/cors.js";
import { ErrorCode } from "./utils/errors.js";
import { swaggerSpec } from "./swagger.js";
import { createAuthRouter } from "./routes/auth/auth.routes.js";
import { createUsersRouter } from "./routes/users/users.routes.js";
import { createSparsRouter } from "./routes/spars/spars.routes.js";
import { createEvaluationRouter } from "./routes/spars/evaluation.routes.js";
import { createNotificationsRouter } from "./routes/notifications/notifications.routes.js";

export function createApp(config: AppConfig) {
  const app = express();
  const logger = createLogger(config);

  // Initialize extensions
  initPool(config);
  initRedis(config);
  initResend(config);
  initJwt(config.jwtAccessSecret, config.jwtRefreshSecret);

  // Core middleware
  app.use(express.json());
  app.use(cookieParser());
  app.use(corsMiddleware(config.isProd));
  app.use(validateRequest);

  // Request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();

    res.on("finish", () => {
      const duration = performance.now() - start;
      logger.info(
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Math.round(duration * 100) / 100,
        },
        `${req.method} ${req.path}`,
      );
    });

    next();
  });

  // Swagger docs
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/docs.json", (_req: Request, res: Response) => {
    res.json(swaggerSpec);
  });

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "healthy" });
  });

  // Register routers (mirrors Flask blueprints)
  app.use("/auth", createAuthRouter(config.isProd));
  app.use("/users", createUsersRouter(config.isProd));
  app.use("/spars", createSparsRouter(config.isProd));
  app.use("/evaluations", createEvaluationRouter(config.isProd));
  app.use("/notifications", createNotificationsRouter(config.isProd));

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(err, "An unexpected error occurred");
    res.status(500).json({
      error: {
        code: ErrorCode.SERVER_ERROR,
        message: "Server is not available, please try again",
      },
    });
  });

  return { app, logger };
}

// Default instance for Vercel/Serverless deployment
const config = getConfig();
const { app, logger } = createApp(config);

export { app, logger, config };
export default app;
