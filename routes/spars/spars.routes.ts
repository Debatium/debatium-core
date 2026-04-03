import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateJson } from "../../middleware/validateJson.js";
import { ErrorCode, errorResponse } from "../../utils/errors.js";
import { DomainValidationError } from "../../db/exceptions.js";
import {
  createSparService, listAvailableSparsService, listMyActiveSparsService,
  listMyHistorySparsService, requestJoinSparService, inviteUserSparService,
  matchingRequestSparService, acceptRequestSparService, declineRequestSparService,
  leaveSparService, kickMemberSparService, cancelSparService, cancelMatchingSparService,
} from "./spars.services.js";

function classifyPgError(err: unknown, context?: string): { code: ErrorCode; message: string; status: number } | null {
  const pgErr = err as { code?: string; message?: string };
  if (!pgErr.code) return null;

  // SP001: custom application error from PostgreSQL functions
  if (pgErr.code === "SP001") {
    return { code: ErrorCode.INVALID_FIELD_VALUE, message: String(pgErr.message || err).split("\n")[0], status: 400 };
  }

  // Context-specific messages per PG error code
  const messages: Record<string, Record<string, string>> = {
    "23505": {
      create: "A spar with this name already exists. Please choose a unique name.",
      request: "You have already requested to join or are already a member of this spar.",
      invite: "This user has already been invited or is already a member.",
      default: "A duplicate entry was detected.",
    },
    "23503": {
      invite: "The target user or the spar session was not found.",
      accept: "The target user or the spar session was not found.",
      cancel: "Spar session not found.",
      default: "A referenced record was not found.",
    },
    "23P01": {
      create: "The provided time slot overlaps with another spar you are hosting or participating in.",
      default: "The provided time slot overlaps with another spar.",
    },
    "23514": {
      default: String(pgErr.message || err).split("\n")[0],
    },
  };

  const msgMap = messages[pgErr.code];
  if (msgMap) {
    const message = (context && msgMap[context]) || msgMap.default;
    return { code: ErrorCode.INVALID_FIELD_VALUE, message, status: 400 };
  }

  if (pgErr.code.startsWith("23")) {
    return { code: ErrorCode.INVALID_FIELD_VALUE, message: "Something is invalid about your data.", status: 400 };
  }
  return null;
}

export function createSparsRouter(isProd: boolean): Router {
  const router = Router();

  // POST /spars — Create spar
  router.post(
    "/",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sparId = await createSparService(req.userId!, req.body);
        res.status(201).json({ message: "Spar created successfully", sparId });
      } catch (err) {
        const pgInfo = classifyPgError(err, "create");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // GET /spars — List available spars (optional auth)
  router.get(
    "/",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Try to extract userId from token if present
        let userId: string | undefined;
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          try {
            const { verifyAccessToken } = await import("../../utils/jwt.js");
            const payload = verifyAccessToken(authHeader.slice(7));
            userId = payload.userId;
          } catch { /* unauthenticated — fine for discover */ }
        }
        const spars = await listAvailableSparsService(userId);
        res.status(200).json(spars);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /spars/me — My active spars
  router.get(
    "/me",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const spars = await listMyActiveSparsService(req.userId!);
        res.status(200).json(spars);
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /spars/me/history — My history
  router.get(
    "/me/history",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const spars = await listMyHistorySparsService(req.userId!);
        res.status(200).json(spars);
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /spars/request — Request to join
  router.post(
    "/request",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await requestJoinSparService(req.userId!, req.body);
        res.status(200).json({ message: "Join request sent successfully" });
      } catch (err) {
        const pgInfo = classifyPgError(err, "request");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // POST /spars/invite — Invite user
  router.post(
    "/invite",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await inviteUserSparService(req.userId!, req.body);
        res.status(200).json({ message: "User invited successfully" });
      } catch (err) {
        const pgInfo = classifyPgError(err, "invite");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // POST /spars/matching — Start matching
  router.post(
    "/matching",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await matchingRequestSparService(req.userId!, req.body);
        res.status(200).json({ message: "Spar status updated to matching" });
      } catch (err) {
        const pgInfo = classifyPgError(err, "matching");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // POST /spars/cancel-matching — Cancel matching
  router.post(
    "/cancel-matching",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await cancelMatchingSparService(req.userId!, req.body);
        res.status(200).json({ message: "Spar status moved back to created" });
      } catch (err) {
        const pgInfo = classifyPgError(err, "matching");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // POST /spars/accept — Accept request/invite
  router.post(
    "/accept",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await acceptRequestSparService(req.userId!, req.body);
        res.status(200).json({ message: "Request accepted successfully" });
      } catch (err) {
        const pgInfo = classifyPgError(err, "accept");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // POST /spars/decline — Decline request/invite
  router.post(
    "/decline",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await declineRequestSparService(req.userId!, req.body);
        res.status(200).json({ message: "Request declined successfully" });
      } catch (err) {
        const pgInfo = classifyPgError(err, "decline");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // POST /spars/leave — Leave spar
  router.post(
    "/leave",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await leaveSparService(req.userId!, req.body);
        res.status(200).json({ message: "Left spar successfully" });
      } catch (err) {
        const pgInfo = classifyPgError(err, "leave");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // POST /spars/kick — Kick member
  router.post(
    "/kick",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await kickMemberSparService(req.userId!, req.body);
        res.status(200).json({ message: "Member kicked successfully" });
      } catch (err) {
        const pgInfo = classifyPgError(err, "kick");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // DELETE /spars — Cancel spar
  router.delete(
    "/",
    requireAuth(isProd),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await cancelSparService(req.userId!, req.body);
        res.status(200).json({ message: "Spar cancelled successfully" });
      } catch (err) {
        const pgInfo = classifyPgError(err, "cancel");
        if (pgInfo) return errorResponse(res, pgInfo.status, pgInfo.code, pgInfo.message);
        next(err);
      }
    }
  );

  // Error handler
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainValidationError || err.name === "DomainValidationError") {
      return errorResponse(res, 400, ErrorCode.INVALID_FIELD_VALUE, err.message);
    }
    _next(err);
  });

  return router;
}
