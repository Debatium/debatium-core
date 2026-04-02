export interface AppConfig {
  isProd: boolean;
  port: number;
  databaseUrl: string;
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;
  logFilePath?: string;
}

const isProd = process.env.MODE !== "dev";

const configs: Record<string, AppConfig> = {
  dev: {
    isProd: false,
    port: parseInt(process.env.PORT || "4000", 10),
    databaseUrl:
      process.env.DATABASE_URL ||
      "postgresql://user:password@localhost:5440/dev_db",
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || "",
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
    logFilePath: process.env.LOG_FILE_PATH,
  },
  prod: {
    isProd: true,
    port: parseInt(process.env.PORT || "4000", 10),
    databaseUrl: process.env.DATABASE_URL || "",
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || "",
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
    logFilePath: process.env.LOG_FILE_PATH,
  },
  testing: {
    isProd: false,
    port: parseInt(process.env.PORT || "4001", 10),
    databaseUrl:
      process.env.TEST_DATABASE_URL ||
      "postgresql://user:password@localhost:5444/test_db",
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || "",
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
    logFilePath: process.env.LOG_FILE_PATH,
  },
};

export function getConfig(env?: string): AppConfig {
  const configName = env || process.env.MODE || "dev";
  return configs[configName] || configs.dev;
}
