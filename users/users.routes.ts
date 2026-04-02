import { Router, Request, Response, NextFunction } from "express";
import { validateJson } from "../middleware/validateJson.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { ErrorCode, errorResponse } from "../utils/errors.js";

export function createUsersRouter(isProd: boolean): Router {
  const router = Router();

  // POST /users — Register
  router.post(
    "/",
    validateJson([
      "fullName",
      "username",
      "password",
      "email",
      "institution",
      "tournamentEntries",
      "avatarURL",
    ]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // TODO: call registerUserService(req.body)
        res.status(201).json({
          success: { message: "User has registered successfully" },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // PUT /users — Update profile
  router.put(
    "/",
    requireAuth(isProd),
    validateJson([
      "fullName",
      "username",
      "email",
      "institution",
      "password",
      "currentPassword",
      "tournamentEntries",
      "avatarURL",
    ]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // TODO: call updateUserService(req.userId, req.body)
        res.status(200).json({
          success: { message: "User profile updated successfully" },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /users — Get own profile
  router.get(
    "/",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // TODO: call getUserProfile(req.userId)
        res.status(200).json({ id: req.userId });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /users/search?q=term
  router.get("/search", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const term = (req.query.q as string || "").trim();
      if (!term) {
        res.status(200).json([]);
        return;
      }
      // TODO: call searchUsersData(term)
      res.status(200).json([]);
    } catch (err) {
      next(err);
    }
  });

  // GET /users/:username — Public profile
  router.get("/:username", async (req: Request, res: Response, next: NextFunction) => {
    try {
      // TODO: call getPublicProfile(req.params.username)
      res.status(200).json({});
    } catch (err) {
      next(err);
    }
  });

  // POST /users/calendar — Add availability
  router.post(
    "/calendar",
    requireAuth(isProd),
    validateJson([
      "startDate",
      "endDate",
      "format",
      "roles",
      "expectedJudgeLevel",
      "expectedDebaterLevel",
    ]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // TODO: call addUserAvailabilityService(req.userId, req.body)
        res.status(201).json({
          success: { message: "Availability added successfully" },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // PUT /users/calendar — Update availability
  router.put(
    "/calendar",
    requireAuth(isProd),
    validateJson([
      "id",
      "startDate",
      "endDate",
      "format",
      "roles",
      "expectedJudgeLevel",
      "expectedDebaterLevel",
    ]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // TODO: call updateUserAvailabilityService(req.userId, req.body.id, req.body)
        res.status(200).json({
          success: { message: "Availability updated successfully" },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // DELETE /users/calendar — Delete availability
  router.delete(
    "/calendar",
    requireAuth(isProd),
    validateJson(["id"]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // TODO: call deleteUserAvailabilityService(req.userId, req.body.id)
        res.status(200).json({
          success: { message: "Availability deleted successfully" },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /users/calendar — Get calendar
  router.get(
    "/calendar",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // TODO: call getUserCalendarService(req.userId)
        res.status(200).json({ calendar: [] });
      } catch (err) {
        next(err);
      }
    }
  );

  // Error handler for user routes
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err.name === "ValueError" || err.name === "DomainValidationError") {
      errorResponse(res, 400, ErrorCode.INVALID_FIELD_VALUE, err.message);
      return;
    }
    _next(err);
  });

  return router;
}
