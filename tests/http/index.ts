import { parseArgs } from "node:util";
import type { Environment } from "../../src/infra/config.env.ts";
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
  },
});

const environment = values.environment as Environment;

new HttpTestRunner(environment, values.workflow).run().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
