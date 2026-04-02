import { Redis } from "@upstash/redis";
import type { AppConfig } from "../config.js";

let redisClient: Redis | null = null;

export function initRedis(config: AppConfig): void {
  if (config.upstashRedisRestUrl && config.upstashRedisRestToken) {
    redisClient = new Redis({
      url: config.upstashRedisRestUrl,
      token: config.upstashRedisRestToken,
    });
  }
}

export function getRedis(): Redis {
  if (!redisClient) {
    throw new Error("Redis client not initialized.");
  }
  return redisClient;
}
