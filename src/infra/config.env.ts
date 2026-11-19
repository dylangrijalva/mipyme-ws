import dotenvx from "@dotenvx/dotenvx";
import z from "zod";

const Environment = z.union([
  z.literal("development"),
  z.literal("staging"),
  z.literal("production"),
  z.literal("test"),
]);

type Environment = z.infer<typeof Environment>;

function blankAsUndefined<TSchema extends z.ZodType>(schema: TSchema) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

const EnvVars = z
  .object({
    PORT: z.coerce.number(),
    NODE_ENV: z.union([z.literal("development"), z.literal("staging"), z.literal("production"), z.literal("test")]),
    DB_URL: z.string(),
    DB_HOST: z.string(),
    DB_USER: z.string(),
    DB_PASSWORD: z.string(),
    DB_NAME: z.string(),
    DB_PORT: z.coerce.number(),
    REDIS_URL: z.string(),
    PUSHER_APP_ID: z.string(),
    PUSHER_KEY: z.string(),
    PUSHER_SECRET: z.string(),
    PUSHER_CLUSTER: z.string(),
    POSTHOG_KEY: z.string(),
    CLERK_SECRET_KEY: z.string(),
    CLERK_JWKS_URL: z.string(),
    CLERK_TEST_USER_ID: z.string().optional(),
    BUCKET_STORAGE_ENDPOINT: z.url(),
    BUCKET_STORAGE_REGION: z.string().nonempty(),
    BUCKET_STORAGE_ACCESS_KEY_ID: z.string().nonempty(),
    BUCKET_STORAGE_SECRET_ACCESS_KEY: z.string().nonempty(),
    BUCKET_STORAGE_BUCKET_NAME: z.string().nonempty(),
    BUCKET_STORAGE_FORCE_PATH_STYLE: z.stringbool(),
    BUCKET_STORAGE_PUBLIC_BASE_URL: z.url(),
    RESEND_API_KEY: blankAsUndefined(z.string().optional()),
    EMAIL_FROM: blankAsUndefined(z.string().optional()),
    APP_URL: blankAsUndefined(z.url().optional()),
  })
  .superRefine((env, ctx) => {
    const sendsEmails = env.NODE_ENV === "staging" || env.NODE_ENV === "production";
    if (!sendsEmails) {
      return;
    }

    for (const key of ["RESEND_API_KEY", "EMAIL_FROM", "APP_URL"] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: "custom", message: `${key} is required in ${env.NODE_ENV}.`, path: [key] });
      }
    }
  });

type EnvVars = z.infer<typeof EnvVars>;

function loadEnvironmentVariables(environment: Environment): EnvVars {
  const ENVIRONMENT_FILES: Record<Environment, string> = {
    development: ".env",
    staging: ".env.staging",
    production: ".env.production",
    test: ".env.test",
  };

  const { parsed } = dotenvx.config({ path: ENVIRONMENT_FILES[environment], quiet: true });
  const env = { ...process.env, ...(parsed ?? {}) };

  const { success, data, error } = EnvVars.safeParse(env);

  if (!success) {
    const missingKeys = error.issues.map((issue) => issue.path.join("."));
    console.error(`One or more required environment variables are missing or invalid: ${missingKeys.join(", ")}`);
    throw Error("Unable to load environment variables. Make sure to provide a valid `.env` file.");
  }

  return data;
}

export { Environment, EnvVars, loadEnvironmentVariables };
