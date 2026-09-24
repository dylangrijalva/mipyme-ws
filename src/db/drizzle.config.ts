import { defineConfig } from "drizzle-kit";
import { loadEnvironmentVariables } from "../infra/config.env.ts";

const env = loadEnvironmentVariables("development");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "mysql",
  dbCredentials: { url: env.DB_URL },
});
