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

  it("clears the merchant metadata of a released login", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        id: "user_sanji",
        email_addresses: [{ id: "idn_1", email_address: "sanji@baratie.example.com" }],
        first_name: "Sanji",
        last_name: null,
        image_url: "https://baratie.example.com/sanji.png",
        public_metadata: {},
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const identity = new IdentityProvider(noopLogger(), createRealtimeEnv());

    const result = await identity.removeFromMerchant("user_sanji");

    expect(result).toMatchObject({ success: true, value: { id: "user_sanji", publicMetadata: {} } });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.clerk.com/v1/users/user_sanji/metadata");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      public_metadata: { merchant_id: null, employee_id: null, account_type: null },
    });
  });

  it("maps a missing Clerk user to resource_not_found when clearing metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ errors: [{ code: "resource_not_found", short_message: "not found" }] }, { status: 404 }),
        ),
    );
    const identity = new IdentityProvider(noopLogger(), createRealtimeEnv());

    const result = await identity.removeFromMerchant("user_sanji");

    expect(result).toEqual(err(expect.objectContaining({ code: codes.resourceNotFound })));
  });
});
