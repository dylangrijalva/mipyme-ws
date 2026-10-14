import type { Context } from "hono/";
import z, { ZodError } from "zod";
import { codes } from "../contracts/business-error.ts";
import type { FacilitoEnv } from "../types.ts";
import { toFacilitoError } from "../utils/to-facilito-error.ts";

const defaultMessage = z.locales.en().localeError;

function formatZodIssueMessage(issue: z.core.$ZodIssue): string {
  const isDefaultTypeMessage =
    issue.code === "invalid_type" && issue.message.startsWith(`Invalid input: expected ${issue.expected}, received `);
  if (!isDefaultTypeMessage && issue.message !== defaultMessage({ ...issue, input: undefined })) {
    return issue.message;
  }

  switch (issue.code) {
    case "invalid_type":
      if (issue.expected === "date") {
        return "Provide a valid date, such as 2026-09-09T00:00:00Z.";
      }

      if (issue.expected === "nonoptional") {
        return "Provide a value for this required field.";
      }

      return `Provide a value of type ${issue.expected === "int" ? "integer" : issue.expected}.`;
    case "too_small":
    case "too_big": {
      const limit = issue.code === "too_small" ? issue.minimum : issue.maximum;
      const comparison = issue.exact
        ? "exactly"
        : issue.code === "too_small"
          ? issue.inclusive
            ? "at least"
            : "more than"
          : issue.inclusive
            ? "at most"
            : "fewer than";
      if (issue.origin === "string") {
        return `Provide text with ${comparison} ${limit} ${Number(limit) === 1 ? "character" : "characters"}.`;
      }

      if (issue.origin === "array" || issue.origin === "set") {
        return `Provide ${comparison} ${limit} ${Number(limit) === 1 ? "item" : "items"}.`;
      }

      const numericComparison = issue.exact
        ? "equal to"
        : issue.code === "too_small"
          ? issue.inclusive
            ? "greater than or equal to"
            : "greater than"
          : issue.inclusive
            ? "less than or equal to"
            : "less than";

      return `Provide a value ${numericComparison} ${limit}.`;
    }
    case "invalid_format":
      if (issue.format === "email") {
        return "Provide a valid email address, such as name@example.com.";
      }

      if (issue.format === "url") {
        return "Provide a complete URL, including its protocol, such as https://example.com/image.webp.";
      }

      if (issue.format === "regex") {
        return "Provide a value matching the format documented for this field.";
      }

      return `Provide a valid ${issue.format.replaceAll("_", " ")} value.`;
    case "not_multiple_of":
      return `Provide a number that is a multiple of ${issue.divisor}.`;
    case "unrecognized_keys":
      return "Remove fields that are not defined in the request schema.";
    case "invalid_value":
      return `Use one of the allowed values: ${issue.values.map((value) => String(value)).join(", ")}.`;
    case "invalid_union":
      return "The value does not match an accepted format. Use one of the alternatives documented for this field.";
    case "invalid_key":
      return "One or more keys are invalid. Use keys matching the documented format.";
    case "invalid_element":
      return "One or more entries are invalid. Use entries matching the documented format.";
    case "custom":
      return "The value does not meet this field's requirements. Check the documented constraints and correct it.";
  }
}

function errorHandler() {
  return async (error: Error, ctx: Context<FacilitoEnv>): Promise<Response> => {
    const { logger } = ctx.var;

    if (error instanceof SyntaxError) {
      logger.error("The request's payload is not formatted correctly");
      return ctx.json(
        toFacilitoError({
          requestId: ctx.var.requestId,
          error: {
            code: codes.validationError,
            message: "The request body contains malformed JSON. Correct the JSON syntax and try again.",
            details: [],
          },
        }),
        400,
      );
    }

    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({
        code: issue.code,
        message: formatZodIssueMessage(issue),
        ...(issue.path.length === 0 ? {} : { field: issue.path.map(String).join(".") }),
      }));

      return ctx.json(
        toFacilitoError({
          requestId: ctx.var.requestId,
          error: {
            code: codes.validationError,
            message: "The payload has one or more validation errors, please fix them and try again.",
            details,
          },
        }),
        400,
      );
    }

    return ctx.json(
      toFacilitoError({
        requestId: ctx.var.requestId,
        error: {
          code: codes.internalServerError,
          message: "Something went wrong on Facilito's end",
          details: [],
        },
      }),
      500,
    );
  };
}

export { errorHandler };
