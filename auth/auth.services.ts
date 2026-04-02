import crypto from "crypto";
import argon2 from "argon2";
import { getPool } from "../extensions/db.js";
import { getRedis } from "../extensions/redis.js";
import { ValueError } from "./auth.routes.js";

export const SESSION_EXPIRATION_SECONDS = 1 * 24 * 60 * 60;

export async function loginService(
  email: string,
  password: string
): Promise<string> {
  const pool = getPool();

  const result = await pool.query(
    'SELECT id, "passwordHash" FROM users WHERE email = $1',
    [email]
  );

  const user = result.rows[0];
  if (!user) {
    throw new ValueError("Invalid email or password.");
  }

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) {
    throw new ValueError("Invalid email or password.");
  }

  const userId = String(user.id);
  const redis = getRedis();

  // 1. Check if user already has an active session
  const activeSessionKey = `user:${userId}:session`;
  const existingSessionId = await redis.get<string>(activeSessionKey);

  // 2. If a session exists, delete it
  if (existingSessionId) {
    await redis.del(existingSessionId);
  }

  // 3. Generate new session
  const sessionId = crypto.randomBytes(32).toString("hex");

  // 4. Save the new session and map the user to this session
  await redis.set(sessionId, userId, { ex: SESSION_EXPIRATION_SECONDS });
  await redis.set(activeSessionKey, sessionId, {
    ex: SESSION_EXPIRATION_SECONDS,
  });

  return sessionId;
}

export async function logoutService(sessionId: string): Promise<void> {
  const redis = getRedis();
  const userId = await redis.get<string>(sessionId);

  if (userId) {
    const activeSessionKey = `user:${userId}:session`;
    await redis.del(activeSessionKey);
  }

  await redis.del(sessionId);
}
