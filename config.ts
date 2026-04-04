export interface AppConfig {
  isProd: boolean;
  port: number;
  databaseUrl: string;
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  resendApiKey: string;
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
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "dev-access-secret",
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "dev-refresh-secret",
    resendApiKey: process.env.RESEND_API_KEY || "",
    logFilePath: process.env.LOG_FILE_PATH,
  },
  prod: {
    isProd: true,
    port: parseInt(process.env.PORT || "4000", 10),
    databaseUrl: process.env.DATABASE_URL || "",
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || "",
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "",
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "",
    resendApiKey: process.env.RESEND_API_KEY || "",
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
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "test-access-secret",
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "test-refresh-secret",
    resendApiKey: process.env.RESEND_API_KEY || "",
    logFilePath: process.env.LOG_FILE_PATH,
  },
};

export function getConfig(env?: string): AppConfig {
  const configName = env || process.env.MODE || "dev";
  return configs[configName] || configs.dev;
}
