import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { getPool } from "../../extensions/db.js";
import {
  getAllUsersAdmin, getAllJudgesAdmin, getAllSparsAdmin,
  getUserDetailAdmin, searchUsersByEmailAdmin,
} from "../../db/admin/queries.js";
import { insertNotification } from "../../db/notifications/queries.js";
import { NotificationChannel, NotificationEventType, NotificationStatus } from "../../db/notifications/domain.js";
import { ErrorCode } from "../../utils/errors.js";

export function createAdminRouter(isProd: boolean): Router {
  const router = Router();

  router.use(requireAuth(isProd), requireAdmin());

  router.get("/users", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await getAllUsersAdmin(getPool());
      res.status(200).json({ data: users });
    } catch (err) {
      next(err);
    }
  });

  router.get("/users/search-email", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const term = String(req.query.q ?? "").trim();
      if (!term) {
        res.status(200).json({ data: [] });
        return;
      }
      const users = await searchUsersByEmailAdmin(getPool(), term);
      res.status(200).json({ data: users });
    } catch (err) {
      next(err);
    }
  });

  router.post("/notifications", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId.trim() : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";

      if (!targetUserId) {
        res.status(400).json({ error: { code: ErrorCode.MISSING_REQUIRED_FIELD, message: "targetUserId is required" } });
        return;
      }
      if (!title || title.length > 80) {
        res.status(400).json({ error: { code: ErrorCode.INVALID_FIELD_VALUE, message: "title is required and must be 80 characters or fewer" } });
        return;
      }
      if (!message || message.length > 280) {
        res.status(400).json({ error: { code: ErrorCode.INVALID_FIELD_VALUE, message: "message is required and must be 280 characters or fewer" } });
        return;
      }

      const pool = getPool();
      const exists = await pool.query("SELECT 1 FROM users WHERE id = $1", [targetUserId]);
      if (!exists.rows.length) {
        res.status(404).json({ error: { code: ErrorCode.NOT_FOUND, message: "Target user not found" } });
        return;
      }

      const id = await insertNotification(pool, {
        customerId: targetUserId,
        eventType: NotificationEventType.ADMIN_ANNOUNCEMENT,
        channel: NotificationChannel.IN_APP,
        referenceId: null,
        referenceType: "admin_announcement",
        payload: { title, message },
        status: NotificationStatus.SENT,
      });

      res.status(201).json({ data: { id } });
    } catch (err) {
      next(err);
    }
  });

  router.get("/users/:username", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const detail = await getUserDetailAdmin(getPool(), String(req.params.username));
      if (!detail) {
        res.status(404).json({
          error: { code: ErrorCode.NOT_FOUND, message: "User not found" },
        });
        return;
      }
      res.status(200).json({ data: detail });
    } catch (err) {
      next(err);
    }
  });

  router.get("/judges", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const judges = await getAllJudgesAdmin(getPool());
      res.status(200).json({ data: judges });
    } catch (err) {
      next(err);
    }
  });

  router.get("/spars", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const spars = await getAllSparsAdmin(getPool());
      res.status(200).json({ data: spars });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
