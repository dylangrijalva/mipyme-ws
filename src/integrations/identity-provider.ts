import { createRemoteJWKSet, jwtVerify } from "jose";
import head from "lodash.head";
import type { Logger } from "pino";
import z from "zod";
import type { AccountType } from "../contracts/account-type.ts";
import { codes, type BusinessError } from "../contracts/business-error.ts";
import type { IdentityAccount } from "../contracts/identity-account.ts";
import { JsonWebTokenPayload } from "../contracts/json-web-token-payload.ts";
import type { EnvVars } from "../infra/config.env.ts";
import { camelCaseKeys } from "../utils/camel-case-keys.ts";
import { err, ok, type Result } from "../utils/result.ts";
import { snakeCaseKeys } from "../utils/snake-case-keys.ts";

const CLERK_API_BASE_URL = "https://api.clerk.com/v1" as const;

const ClerkUser = z.object({
  id: z.string(),
  emailAddresses: z.array(
    z.object({
      id: z.string(),
      emailAddress: z.email(),
    }),
  ),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  imageUrl: z.url(),
  publicMetadata: z.record(z.string(), z.unknown()),
});

const ClerkErrorResponse = z.object({
  errors: z.array(
    z.object({
      code: z.string(),
      // Some Clerk errors, such as `feature_not_enabled`, omit it.
      shortMessage: z.string().optional(),
    }),
  ),
});

type ClerkUser = z.infer<typeof ClerkUser>;

type ClerkErrorResponse = z.infer<typeof ClerkErrorResponse>;

type AssignToMerchantParams = {
  accountId: string;
  name: string;
  merchantId: string;
  employeeId: string;
  accountType: AccountType;
};

class IdentityProvider {
  private readonly logger: Logger;
  private readonly env: EnvVars;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(logger: Logger, env: EnvVars) {
    this.logger = logger.child({ _tag: this.constructor.name });
    this.env = env;
    this.jwks = createRemoteJWKSet(new URL(env.CLERK_JWKS_URL));
  }

  async verifyToken(token: string): Promise<Result<JsonWebTokenPayload, BusinessError>> {
    try {
      const { payload } = await jwtVerify(token, this.jwks);
      const claims = JsonWebTokenPayload.parse(camelCaseKeys(payload));
      return ok(claims);
    } catch (exception) {
      this.logger.error({ err: exception }, "Invalid OAuth token");

      const error: BusinessError = {
        code: codes.invalidOAuthToken,
        message: "The OAuth token is invalid or expired.",
        details: [],
      };

      return err(error);
    }
  }

  async find(id: string): Promise<Result<IdentityAccount, BusinessError>> {
    const response = await fetch(`${CLERK_API_BASE_URL}/users/${id}`, {
      headers: {
        Authorization: `Bearer ${this.env.CLERK_SECRET_KEY}`,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      const clerkError = ClerkErrorResponse.parse(camelCaseKeys(data));
      const error = this.asError(clerkError);

      return err(error);
    }

    const data = await response.json();
    const clerkUser = ClerkUser.parse(camelCaseKeys(data));
    const account = this.asDomain(clerkUser);

    return ok(account);
  }

  async assignToMerchant(params: AssignToMerchantParams): Promise<Result<IdentityAccount, BusinessError>> {
    let response = await fetch(`${CLERK_API_BASE_URL}/users/${params.accountId}/metadata`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.env.CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        snakeCaseKeys({
          publicMetadata: {
            merchantId: params.merchantId,
            employeeId: params.employeeId,
            accountType: params.accountType,
          },
        }),
      ),
    });

    if (!response.ok) {
      const data = await response.json();
      const clerkError = ClerkErrorResponse.parse(camelCaseKeys(data));
      const error = this.asError(clerkError);

      return err(error);
    }

    response = await fetch(`${CLERK_API_BASE_URL}/users/${params.accountId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.env.CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        snakeCaseKeys({
          firstName: params.name,
        }),
      ),
    });

    if (!response.ok) {
      const data = await response.json();
      const clerkError = ClerkErrorResponse.parse(camelCaseKeys(data));
      const error = this.asError(clerkError);

      return err(error);
    }

    const data = await response.json();
    const clerkUser = ClerkUser.parse(camelCaseKeys(data));
    const account = this.asDomain(clerkUser);

    return ok(account);
  }

  private asDomain(user: ClerkUser): IdentityAccount {
    return {
      id: user.id,
      email: head(user.emailAddresses)?.emailAddress || null,
      name: `${user.firstName} ${user.lastName}`,
      pictureUrl: user.imageUrl,
      publicMetadata: user.publicMetadata,
    };
  }

  private asError(clerkError: ClerkErrorResponse): BusinessError {
    const knownError = head(clerkError.errors);

    if (!knownError) {
      return {
        code: codes.internalServerError,
        message: "An unexpected error has ocurred during request execution.",
        details: [],
      };
    }

    switch (knownError.code) {
      case "resource_not_found":
        return {
          code: codes.resourceNotFound,
          message: "The provided account doesn't exist in our platform.",
          details: [],
        };

      case "form_param_value_invalid":
      case "form_param_type_invalid":
      case "form_param_format_invalid":
      case "form_param_missing":
      case "form_param_unknown":
      case "form_param_max_length_exceeded":
      case "form_param_exceeds_allowed_size":
      case "request_body_invalid":
      case "request_body_too_large":
        return {
          code: codes.validationError,
          message: "The payload has one or more validation errors, please fix them and try again.",
          details: [],
        };

      case "too_many_requests":
        return {
          code: codes.rateLimitExceeded,
          message: "Too many account requests. Please wait and try again.",
          details: [],
        };

      case "resource_locked":
      case "conflict":
        return {
          code: codes.conflictError,
          message: "The account could not be updated because of a conflict. Please try again.",
          details: [],
        };

      default:
        return {
          code: codes.internalServerError,
          message: "An unexpected error has ocurred during request execution.",
          details: [],
        };
    }
  }
}

export { IdentityProvider };
