import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../src/contracts/business-error.ts";
import { noopLogger } from "../../src/infra/config.logger.ts";
import { IdentityProvider } from "../../src/integrations/identity-provider.ts";
import { err, ok } from "../../src/utils/result.ts";
import { createRealtimeEnv } from "../test-utils/realtime-env.ts";

function setup(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  const identity = new IdentityProvider(noopLogger(), createRealtimeEnv());

  return { fetchMock, identity };
}

function clerkErrorResponse(code: string, status: number): Response {
  return Response.json({ errors: [{ code, short_message: code, message: code }] }, { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IdentityProvider.addPhoneNumber", () => {
  it("adds the number to the Clerk user as an unverified primary phone number", async () => {
    const { fetchMock, identity } = setup(Response.json({ id: "idn_luffy_phone", phone_number: "+593987654321" }));

    const result = await identity.addPhoneNumber({ accountId: "user_luffy", phoneNumber: "+593987654321" });

    expect(result).toEqual(ok(undefined));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.clerk.com/v1/phone_numbers");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(init?.body as string)).toEqual({
      user_id: "user_luffy",
      phone_number: "+593987654321",
      verified: false,
      primary: true,
    });
  });

  it("reports a number already used by another Clerk user as a phone conflict", async () => {
    const { identity } = setup(clerkErrorResponse("form_identifier_exists", 422));

    const result = await identity.addPhoneNumber({ accountId: "user_luffy", phoneNumber: "+593987654321" });

    expect(result).toEqual(
      err({
        code: codes.phoneNumberAlreadyExists,
        message: "The phone number is already in use by another account.",
        details: [],
      }),
    );
  });

  it("maps other Clerk failures through the shared error translation", async () => {
    const { identity } = setup(clerkErrorResponse("form_param_format_invalid", 422));

    const result = await identity.addPhoneNumber({ accountId: "user_luffy", phoneNumber: "+593987654321" });

    expect(result).toEqual(err(expect.objectContaining({ code: codes.validationError })));
  });

  it("reports an instance with phone numbers disabled as an internal error", async () => {
    const { identity } = setup(
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
    );

    const result = await identity.addPhoneNumber({ accountId: "user_luffy", phoneNumber: "+593987654321" });

    expect(result).toEqual(err(expect.objectContaining({ code: codes.internalServerError })));
  });
});

describe("IdentityProvider.find", () => {
  it("exposes the phone numbers already attached to the Clerk user", async () => {
    const { identity } = setup(
      Response.json({
        id: "user_luffy",
        email_addresses: [{ id: "idn_luffy_email", email_address: "luffy@strawhatpirates.example.com" }],
        phone_numbers: [{ id: "idn_luffy_phone", phone_number: "+593987654321" }],
        first_name: "Monkey D.",
        last_name: "Luffy",
        image_url: "https://strawhatpirates.example.com/luffy.png",
        public_metadata: {},
      }),
    );

    const result = await identity.find("user_luffy");

    expect(result.value?.phoneNumbers).toEqual(["+593987654321"]);
  });
});
