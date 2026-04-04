import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { getPool } from "../../extensions/db.js";
import { getNotifications, markNotificationRead, getUnreadCount } from "../../db/notifications/queries.js";

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notification management
 */
export function createNotificationsRouter(isProd: boolean): Router {
  const router = Router();

  // GET /notifications — paginated in-app notifications
  router.get(
    "/",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const limit = Math.min(parseInt(String(req.query.limit ?? "20")), 100);
        const offset = parseInt(String(req.query.offset ?? "0"));
        const pool = getPool();
        const notifications = await getNotifications(pool, req.userId!, limit, offset);
        res.status(200).json({
          data: notifications,
          pagination: { limit, offset },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // PATCH /notifications/:id/read — mark as read
  router.patch(
    "/:id/read",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pool = getPool();
        await markNotificationRead(pool, String(req.params.id), req.userId!);
        res.status(200).json({ message: "Notification updated" });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /notifications/unread-count
  router.get(
    "/unread-count",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pool = getPool();
        const count = await getUnreadCount(pool, req.userId!);
        res.status(200).json({ data: { count } });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
