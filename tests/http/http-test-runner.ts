import { runFromFile, type WorkflowEnv, type WorkflowResult } from "@stepci/runner";
import chalk from "chalk";
import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

class HttpTestRunner {
  private readonly environment: WorkflowEnv;
  private readonly workflowNames: Array<string>;
  private readonly verbose: boolean;

  constructor(environment: WorkflowEnv, workflowNames: Array<string> = [], verbose = false) {
    this.environment = environment;
    this.workflowNames = workflowNames;
    this.verbose = verbose;
  }

  async run(): Promise<void> {
    const workflowsDirectory = fileURLToPath(new URL("./workflows/", import.meta.url));
    const entries = await readdir(workflowsDirectory, { withFileTypes: true });
    const availableWorkflowEntries = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.yaml"))
      .map((entry) => resolve(workflowsDirectory, entry.name))
      .sort();

    const selectedWorkflowEntries =
      this.workflowNames.length === 0
        ? availableWorkflowEntries
        : this.workflowNames.map((name) => {
            const filename = name.endsWith(".spec.yaml") ? name : name + ".spec.yaml";
            const workflowEntry = availableWorkflowEntries.find((entry) => basename(entry) === filename);
            if (!workflowEntry) {
              throw new Error("Unknown HTTP workflow: " + name);
            }
            return workflowEntry;
          });

    const workflowEntries = [...new Set(selectedWorkflowEntries)].sort();

    for (const workflowEntry of workflowEntries) {
      const workflow = basename(workflowEntry);
      const { result } = await runFromFile(workflowEntry, { env: this.environment });
      this.reportWorkflowResult(workflow, result);

      if (!result.passed) {
        throw new Error("HTTP workflow failed: " + workflow);
      }
    }
  }

  private reportWorkflowResult(workflow: string, result: WorkflowResult["result"]) {
    const formatStatusIcon = (passed: boolean) => (passed ? chalk.green("✓") : chalk.red("✗"));
    const formatDuration = (duration: unknown, numberColor = chalk.yellow) =>
      numberColor(String(duration)) + chalk.yellow.dim("ms");
    const formatTestResult = (test: (typeof result.tests)[number]) =>
      "  " + formatStatusIcon(test.passed) + " " + (test.name ?? test.id) + " " + formatDuration(test.duration);
    const summary =
      formatStatusIcon(result.passed) +
      "  " +
      chalk.bgMagenta.black("http") +
      " " +
      chalk.gray("tests/http/workflows/" + workflow) +
      " " +
      chalk.gray("(" + result.tests.length + " tests)") +
      " " +
      formatDuration(result.duration);

    if (!this.verbose) {
      console.log([summary, ...result.tests.map(formatTestResult)].join("\n"));
      return;
    }

    const steps = result.tests.flatMap((test) => test.steps);
    const passedTestCount = result.tests.filter((test) => test.passed).length;
    const passedStepCount = steps.filter((step) => step.passed && !step.skipped).length;
    const failedStepCount = steps.filter((step) => !step.passed && !step.skipped).length;
    const skippedStepCount = steps.filter((step) => step.skipped).length;
    const lines = [
      summary,
      chalk.gray(
        passedTestCount +
          "/" +
          result.tests.length +
          " tests passed · " +
          passedStepCount +
          "/" +
          steps.length +
          " steps passed · " +
          failedStepCount +
          " failed · " +
          skippedStepCount +
          " skipped · " +
          result.duration +
          "ms · " +
          result.bytesSent +
          " B sent / " +
          result.bytesReceived +
          " B received",
      ),
    ];

    const formatValue = (value: unknown) => JSON.stringify(value) ?? String(value);
    const appendChecks = (checks: unknown, parentName = "") => {
      if (typeof checks !== "object" || checks === null) {
        return;
      }

      for (const [checkName, checkResult] of Object.entries(checks)) {
        const fullName = parentName ? parentName + "." + checkName : checkName;

        if (
          typeof checkResult === "object" &&
          checkResult !== null &&
          "passed" in checkResult &&
          typeof checkResult.passed === "boolean"
        ) {
          lines.push(
            "    " +
              (checkResult.passed ? "✓" : "✗") +
              " " +
              fullName +
              ": " +
              (checkResult.passed ? chalk.green("passed") : chalk.red("failed")),
          );
          const isPassedSchema = fullName === "schema" && checkResult.passed;
          const expected = isPassedSchema ? "[json]" : formatValue(checkResult.expected);
          const received = isPassedSchema ? "[json]" : formatValue(checkResult.given);
          const valueColor = checkResult.passed ? chalk.cyan : chalk.red;
          lines.push(
            chalk.gray("       expected ") + valueColor(expected) + chalk.gray(", received ") + valueColor(received),
          );
          continue;
        }

        appendChecks(checkResult, fullName);
      }
    };

    for (const test of result.tests) {
      lines.push(formatTestResult(test));

      for (const step of test.steps) {
        const statusIcon = step.skipped ? "⏭️" : step.passed ? "✓" : "✗";
        const statusLabel = step.skipped
          ? chalk.yellow("skipped")
          : step.passed
            ? chalk.green("passed")
            : step.errored
              ? chalk.red("error")
              : chalk.red("failed");

        lines.push(
          "    " +
            statusIcon +
            " " +
            (step.name ?? step.id ?? step.type ?? "Unnamed step") +
            " " +
            statusLabel +
            " " +
            formatDuration(step.duration, chalk.gray),
        );

        if (step.response?.status !== undefined) {
          lines.push(
            chalk.gray("       HTTP " + step.response.status + " · response ") +
              formatDuration(step.responseTime, chalk.gray),
          );
        }

        if (step.errorMessage) {
          lines.push("       " + chalk.red(step.errorMessage));
        }
        appendChecks(step.checks);
      }
    }

    console.log(lines.join("\n"));
  }
}

export { HttpTestRunner };
