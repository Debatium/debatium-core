import { vi } from "vitest";
import supertest from "supertest";
import { createApp } from "../app.js";
import { getConfig } from "../config.js";

// Mock Upstash Redis globally to avoid external network calls during tests
const redisStore = new Map();
vi.mock("@upstash/redis", () => {
  return {
    Redis: vi.fn().mockImplementation(function () {
      return {
        get: vi.fn(async (key: string) => redisStore.get(key) || null),
        set: vi.fn(async (key: string, value: any) => {
          redisStore.set(key, value);
        }),
        del: vi.fn(async (key: string) => {
          redisStore.delete(key);
        }),
      };
    }),
  };
});

// Create a singleton instance of the app for tests
const config = getConfig("testing");
const { app, logger } = createApp(config);
export const request = supertest(app);

/**
 * Helper to create a test user and return their session data.
 */
export async function createAuthenticatedUser(
  options: {
    email?: string;
    password?: string;
    fullName?: string;
    username?: string;
  } = {},
) {
  const email =
    options.email ||
    `test_${Math.random().toString(36).substring(2)}@example.com`;
  const password = options.password || "TestPassword123@";
  const fullName = options.fullName || "Test User";
  const username =
    options.username ||
    `testuser_${Math.random().toString(36).substring(7)}`.replace(
      /[^a-zA-Z0-0_]/g,
      "_",
    );

  // Register user
  const regRes = await request.post("/auth/register").send({
    fullName,
    username,
    email,
    password,
    institution: "Test University",
    tournamentEntries: [],
    avatarURL: 1,
  });

  if (regRes.status !== 201) {
    throw new Error(`Registration failed: ${JSON.stringify(regRes.body)}`);
  }

  // Login to get tokens (set as cookies)
  const loginRes = await request.post("/auth/login").send({ email, password });

  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
  }

  // Extract accessToken from cookies
  const cookies = loginRes.header["set-cookie"] || [];
  const accessTokenCookie = cookies.find((c: string) =>
    c.startsWith("accessToken="),
  );
  const accessToken = accessTokenCookie?.split(";")[0].split("=")[1];

  if (!accessToken) {
    throw new Error("Failed to extract accessToken from login cookies");
  }

  return {
    user: loginRes.body.user,
    accessToken,
    authHeader: { Authorization: `Bearer ${accessToken}` },
  };
}
