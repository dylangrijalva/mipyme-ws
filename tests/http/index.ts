import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import type { Environment } from "../../src/infra/config.env.ts";
import { HttpTestEnvironment } from "./http-test-environment.ts";
import { HttpTestRunner } from "./http-test-runner.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    environment: {
      type: "string",
      default: "test",
    },
    workflow: {
      type: "string",
      multiple: true,
    },
    verbose: {
      type: "boolean",
      default: false,
    },
  },
});

const environment = values.environment as Environment;
const workflowFixtureDirectory = fileURLToPath(new URL("./workflow-fixtures", import.meta.url));

new HttpTestEnvironment(environment)
  .run((workflowEnvironment) =>
    new HttpTestRunner({ ...workflowEnvironment, workflowFixtureDirectory }, values.workflow, values.verbose).run(),
  )
  .then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
