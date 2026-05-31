export interface AppConfig {
  isProd: boolean;
  port: number;
  databaseUrl: string;
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  resendApiKey: string;
  feUrl: string;
  logFilePath?: string;
  awsS3AccessKey: string;
  awsS3SecretAccessKey: string;
  awsRegion: string;
  awsS3BucketName: string;
}

const isProd = process.env.MODE !== "dev";

const configs: Record<string, AppConfig> = {
  dev: {
    isProd: false,
    port: parseInt(process.env.PORT || "4000", 10),
    databaseUrl: process.env.DATABASE_URL || "postgresql://user:password@localhost:5440/dev_db",
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || "",
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "dev-access-secret",
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "dev-refresh-secret",
    resendApiKey: process.env.RESEND_API_KEY || "",
    feUrl: process.env.FE_URL || "http://localhost:5173",
    logFilePath: process.env.LOG_FILE_PATH,
    awsS3AccessKey: process.env.AWS_S3_ACCESS_KEY || "",
    awsS3SecretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY || "",
    awsRegion: process.env.AWS_REGION || "",
    awsS3BucketName: process.env.AWS_S3_BUCKET_NAME || "",
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
    feUrl: process.env.FE_URL || "",
    logFilePath: process.env.LOG_FILE_PATH,
    awsS3AccessKey: process.env.AWS_S3_ACCESS_KEY || "",
    awsS3SecretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY || "",
    awsRegion: process.env.AWS_REGION || "",
    awsS3BucketName: process.env.AWS_S3_BUCKET_NAME || "",
  },
  testing: {
    isProd: false,
    port: parseInt(process.env.PORT || "4001", 10),
    databaseUrl: "postgresql://user:password@localhost:5444/test_db",
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || "",
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "test-access-secret",
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "test-refresh-secret",
    resendApiKey: process.env.RESEND_API_KEY || "",
    feUrl: process.env.FE_URL || "http://localhost:5173",
    logFilePath: process.env.LOG_FILE_PATH,
    awsS3AccessKey: process.env.AWS_S3_ACCESS_KEY || "",
    awsS3SecretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY || "",
    awsRegion: process.env.AWS_REGION || "",
    awsS3BucketName: process.env.AWS_S3_BUCKET_NAME || "",
  },
};

export function getConfig(env?: string): AppConfig {
  const configName = env || process.env.MODE || "dev";
  return configs[configName] || configs.dev;
}
