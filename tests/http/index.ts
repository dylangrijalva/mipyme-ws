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
  },
});

const environment = values.environment as Environment;

new HttpTestRunner(environment).run().finally(() => {
  process.exit(0);
});
