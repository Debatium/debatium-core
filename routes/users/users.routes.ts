import { Router, Request, Response, NextFunction } from "express";
import { validateJson } from "../../middleware/validateJson.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { ErrorCode, errorResponse } from "../../utils/errors.js";
import { getPool } from "../../extensions/db.js";
import { DomainValidationError } from "../../db/exceptions.js";
import { getUserProfileData, getPublicProfileData, searchUsersData } from "../../db/users/queries.js";
import {
  updateUserService,
  bulkAddUserAvailabilityService,
  updateUserAvailabilityService,
  deleteUserAvailabilityService,
  getUserCalendarService,
  getOrCreateCalendarLinksService,
} from "./users.services.js";

function classifyPgError(err: unknown): { code: ErrorCode; message: string; status: number } | null {
  const pgErr = err as { code?: string };
  if (!pgErr.code) return null;

  switch (pgErr.code) {
    case "23505":
      return { code: ErrorCode.INVALID_FIELD_VALUE, message: "Username or email is already taken.", status: 400 };
    case "23503":
      return { code: ErrorCode.INVALID_FIELD_VALUE, message: "A referenced record does not exist.", status: 400 };
    case "23P01":
      return { code: ErrorCode.INVALID_FIELD_VALUE, message: "The provided time slots overlap with your existing availability. Please choose a different time.", status: 400 };
    case "23502":
      return { code: ErrorCode.MISSING_REQUIRED_FIELD, message: "A required field is missing.", status: 400 };
    case "P0001":
      return { code: ErrorCode.INVALID_FIELD_VALUE, message: String(err).split("\n")[0], status: 400 };
    case "22P02":
      return { code: ErrorCode.INVALID_FIELD_VALUE, message: "An invalid value was provided for a field. Please ensure your formats are valid.", status: 400 };
    default:
      if (pgErr.code.startsWith("23")) {
        return { code: ErrorCode.INVALID_FIELD_VALUE, message: "Something is invalid about your data.", status: 400 };
      }
      return null;
  }
}

export function createUsersRouter(isProd: boolean): Router {
  const router = Router();

  // PUT /users/profile — Update profile
  router.put(
    "/profile",
    requireAuth(isProd),
    validateJson([
      "fullName", "username", "email", "institution",
      "password", "currentPassword", "tournamentEntries", "avatarURL",
    ]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await updateUserService(req.userId!, req.body);
        res.status(200).json({ success: { message: "User profile updated successfully" } });
      } catch (err) {
        const pgInfo = classifyPgError(err);
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // GET /users/profile — Get own profile
  router.get(
    "/profile",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const pool = getPool();
        const profile = await getUserProfileData(pool, req.userId!);
        if (!profile) {
          return errorResponse(res, 404, ErrorCode.INVALID_FIELD_VALUE, "User profile not found");
        }
        profile.id = req.userId!;
        res.status(200).json(profile);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /users/search?q=term
  router.get("/search", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const term = (String(req.query.q ?? "")).trim();
      if (!term) {
        res.status(200).json([]);
        return;
      }
      const pool = getPool();
      const users = await searchUsersData(pool, term);
      res.status(200).json(users);
    } catch (err) {
      next(err);
    }
  });

  // GET /users/:username — Public profile
  router.get("/:username", async (req: Request, res: Response, next: NextFunction) => {
    // Reserved paths handled by specific routes below; fall through to them
    // instead of treating "calendar" as a username and returning 404.
    const username = String(req.params.username);
    if (username === "calendar" || username === "calendar-link") {
      return next();
    }
    try {
      const pool = getPool();
      const profile = await getPublicProfileData(pool, username);
      if (!profile) {
        return errorResponse(res, 404, ErrorCode.INVALID_FIELD_VALUE, "User not found");
      }
      res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  });

  // POST /users/availability/bulk — Create one availability profile with a slots[] array
  router.post(
    "/availability/bulk",
    requireAuth(isProd),
    validateJson(["name", "slots", "format", "roles", "expectedJudgeLevel", "expectedDebaterLevel"]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { count, id } = await bulkAddUserAvailabilityService(req.userId!, req.body);
        res.status(201).json({
          success: { message: `${count} availability slot(s) added successfully` },
          id,
          count,
        });
      } catch (err) {
        const pgInfo = classifyPgError(err);
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // PUT /users/calendar — Update an availability profile (replaces slots[] + metadata)
  router.put(
    "/calendar",
    requireAuth(isProd),
    validateJson([
      "id", "name", "slots", "format", "roles",
      "expectedJudgeLevel", "expectedDebaterLevel",
    ]),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const availabilityId = req.body.id;
        if (!availabilityId) {
          return errorResponse(res, 400, ErrorCode.INVALID_FIELD_VALUE, "Field 'id' is required in JSON body");
        }
        await updateUserAvailabilityService(req.userId!, availabilityId, req.body);
        res.status(200).json({ success: { message: "Availability updated successfully" } });
      } catch (err) {
        const pgInfo = classifyPgError(err);
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
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
        await deleteUserAvailabilityService(req.userId!, req.body.id);
        res.status(200).json({ success: { message: "Availability deleted successfully" } });
      } catch (err) {
        const pgInfo = classifyPgError(err);
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
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
        const calendar = await getUserCalendarService(req.userId!);
        res.status(200).json({ calendar });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /users/calendar-link — Get calendar links
  router.get(
    "/calendar-link",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const links = await getOrCreateCalendarLinksService(req.userId!, req.protocol + "://" + req.get("host") + "/");
        res.status(200).json({ links });
      } catch (err) {
        return errorResponse(res, 400, ErrorCode.INVALID_FIELD_VALUE, (err as Error).message);
      }
    }
  );

  // Error handler for user routes
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainValidationError || err.name === "DomainValidationError") {
      return errorResponse(res, 400, ErrorCode.INVALID_FIELD_VALUE, err.message);
    }
    if (err.name === "ValueError" || err.name === "KeyError") {
      const msg = err.name === "KeyError"
        ? `Missing required field in payload: ${err.message}`
        : err.message;
      return errorResponse(res, 400, ErrorCode.INVALID_FIELD_VALUE, msg);
    }
    _next(err);
  });

  return router;
}
