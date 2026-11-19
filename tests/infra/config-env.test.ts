import { describe, expect, it } from "vitest";
import { EnvVars, type Environment } from "../../src/infra/config.env.ts";
import { createRealtimeEnv } from "../test-utils/realtime-env.ts";

const EMAIL_SETTINGS = ["RESEND_API_KEY", "EMAIL_FROM", "APP_URL"] as const;

function environmentWithoutEmail(environment: Environment, value: string | undefined) {
  const env: Record<string, unknown> = Object.fromEntries(
    Object.entries(createRealtimeEnv()).map(([key, value]) => [key, String(value)]),
  );
  env["NODE_ENV"] = environment;
  for (const key of EMAIL_SETTINGS) {
    env[key] = value;
  }
  return env;
}

describe("EnvVars", () => {
  it.each(["staging", "production"] as const)(
    "requires every email setting in %s, treating blanks as missing",
    (environment) => {
      const result = EnvVars.safeParse(environmentWithoutEmail(environment, ""));

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([...EMAIL_SETTINGS].sort());
    },
  );

  it.each(["development", "test"] as const)("lets %s run without email settings", (environment) => {
    const result = EnvVars.safeParse(environmentWithoutEmail(environment, undefined));

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ RESEND_API_KEY: undefined, EMAIL_FROM: undefined, APP_URL: undefined });
  });
});
