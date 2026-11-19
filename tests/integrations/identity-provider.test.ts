import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../src/contracts/business-error.ts";
import { noopLogger } from "../../src/infra/config.logger.ts";
import { IdentityProvider } from "../../src/integrations/identity-provider.ts";
import { err } from "../../src/utils/result.ts";
import { createRealtimeEnv } from "../test-utils/realtime-env.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IdentityProvider", () => {
  it("returns an internal error when Clerk replies with an error that has no short message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            errors: [
              {
                message: "not enabled",
                long_message: "This feature is not enabled on this instance",
                code: "feature_not_enabled",
              },
            ],
          },
          { status: 403 },
        ),
      ),
    );
    const identity = new IdentityProvider(noopLogger(), createRealtimeEnv());

    const result = await identity.find("user_luffy");

    expect(result).toEqual(err(expect.objectContaining({ code: codes.internalServerError })));
  });
});
