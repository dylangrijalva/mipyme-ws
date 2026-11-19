import { EnvVars, type Environment } from "../../src/infra/config.env.ts";

function createRealtimeEnv(environment: Environment = "test"): EnvVars {
  return EnvVars.parse({
    NODE_ENV: environment,
    PORT: 3000,
    DB_URL: "mysql://localhost/strawhatpirates",
    DB_HOST: "localhost",
    DB_USER: "luffy",
    DB_PASSWORD: "test-password",
    DB_NAME: "strawhatpirates",
    DB_PORT: 3306,
    REDIS_URL: "redis://localhost:6379",
    PUSHER_APP_ID: "123",
    PUSHER_KEY: "test-key",
    PUSHER_SECRET: "test-secret",
    PUSHER_CLUSTER: "us2",
    POSTHOG_KEY: "test-key",
    CLERK_SECRET_KEY: "test-key",
    CLERK_JWKS_URL: "https://strawhatpirates.example.com/jwks",
    BUCKET_STORAGE_ENDPOINT: "https://storage.example.com",
    BUCKET_STORAGE_REGION: "us-east-1",
    BUCKET_STORAGE_ACCESS_KEY_ID: "test-key",
    BUCKET_STORAGE_SECRET_ACCESS_KEY: "test-secret",
    BUCKET_STORAGE_BUCKET_NAME: "strawhatpirates",
    BUCKET_STORAGE_FORCE_PATH_STYLE: "true",
    BUCKET_STORAGE_PUBLIC_BASE_URL: "https://storage.example.com",
    RESEND_API_KEY: "test-resend-key",
    EMAIL_FROM: "Mipyme <hello@strawhatpirates.example.com>",
    APP_URL: "https://app.strawhatpirates.example.com",
  });
}

export { createRealtimeEnv };
