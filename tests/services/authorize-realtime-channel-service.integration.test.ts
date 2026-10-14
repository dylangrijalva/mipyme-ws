import { Redis } from "ioredis";
import { createHmac } from "node:crypto";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.ts";
import { tables } from "../../src/db/schema.ts";
import { CollectionFinder } from "../../src/finders/collection-finder.ts";
import { CustomerFinder } from "../../src/finders/customer-finder.ts";
import { MerchantFinder } from "../../src/finders/merchant-finder.ts";
import { ProductFinder } from "../../src/finders/product-finder.ts";
import { PurchaseFinder } from "../../src/finders/purchase-finder.ts";
import { SaleFinder } from "../../src/finders/sale-finder.ts";
import { SupplierFinder } from "../../src/finders/supplier-finder.ts";
import { IdentityProvider } from "../../src/integrations/identity-provider.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";
import type { CurrentUser } from "../../src/contracts/current-user.ts";
import { RealtimeEventPublisher } from "../../src/integrations/realtime-event-publisher.ts";
import { AuthorizeRealtimeChannelService } from "../../src/services/authorize-realtime-channel-service.ts";
import { err, ok } from "../../src/utils/result.ts";
import { createRealtimeEnv } from "../test-utils/realtime-env.ts";

function setup(accountType: CurrentUser["accountType"] = "owner") {
  const user: CurrentUser = {
    id: "account_luffy",
    employeeId: "employee_luffy",
    merchantId: "merch_STRAWHATPIRATES0000",
    email: "luffy@strawhatpirates.example.com",
    accountType,
  };
  const env = createRealtimeEnv();
  const logger = pino({ enabled: false });
  const publisher = new RealtimeEventPublisher({ env, logger });
  const service = AuthorizeRealtimeChannelService.create({ logger, user, publisher });
  return { service, publisher, user, env };
}

describe("AuthorizeRealtimeChannelService", () => {
  it.each(["owner", "staff"] as const)("signs the current merchant's subscription for a %s", async (accountType) => {
    const { service, user, env } = setup(accountType);
    const socketId = "123.456";
    const channelName = `private-${user.merchantId}`;
    const signature = createHmac("sha256", env.PUSHER_SECRET).update(`${socketId}:${channelName}`).digest("hex");

    const result = await service.execute({ socketId, channelName });

    expect(result).toEqual(ok({ auth: `${env.PUSHER_KEY}:${signature}` }));
  });

  it.each([
    { scenario: "another merchant", channelName: "private-merch_HEARTPIRATES0000000" },
    { scenario: "a public channel", channelName: "merch_STRAWHATPIRATES0000" },
    { scenario: "a presence channel", channelName: "presence-merch_STRAWHATPIRATES0000" },
    { scenario: "an encrypted channel", channelName: "private-encrypted-merch_STRAWHATPIRATES0000" },
    { scenario: "a merchant channel suffix", channelName: "private-merch_STRAWHATPIRATES0000-sales" },
  ])("rejects $scenario without requesting a signature", async ({ channelName }) => {
    const { service, publisher } = setup();
    const authorize = vi.spyOn(publisher, "authorizeChannelSubscription");

    const result = await service.execute({ socketId: "123.456", channelName });

    expect(result).toEqual(
      err({
        code: "forbidden_error",
        message: "You can only subscribe to your business's realtime channel.",
        details: [],
      }),
    );
    expect(authorize).not.toHaveBeenCalled();
  });
});

async function setupRoute(status: "enabled" | "disabled" | null) {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const externalId = "clerk_luffy";
  const env = createRealtimeEnv();
  const logger = pino({ enabled: false });
  const identity = new IdentityProvider(logger, env);
  vi.spyOn(identity, "verifyToken").mockResolvedValue(
    ok({
      sub: externalId,
      email: "luffy@strawhatpirates.example.com",
      merchantId: "merch_HEARTPIRATES0000000",
      accountType: "owner",
    }),
  );
  if (status) {
    const accountId = generateId({ model: "account" });
    await db.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates" });
    await db
      .insert(tables.account)
      .values({ id: accountId, externalId, merchantId, email: "luffy@strawhatpirates.example.com" });
    await db
      .insert(tables.employee)
      .values({ id: generateId({ model: "employee" }), accountId, merchantId, name: "Luffy", isOwner: false, status });
  }
  const cache = new Redis(env.REDIS_URL, { lazyConnect: true });
  vi.spyOn(cache, "eval").mockResolvedValue(1);
  const publisher = new RealtimeEventPublisher({ env, logger });
  const authorize = vi.spyOn(publisher, "authorizeChannelSubscription");
  const app = createApp({
    logger,
    env,
    db,
    cache,
    identity,
    publisher,
    merchantFinder: new MerchantFinder(),
    collectionFinder: new CollectionFinder(),
    customerFinder: new CustomerFinder(),
    supplierFinder: new SupplierFinder(),
    productFinder: new ProductFinder(),
    purchaseFinder: new PurchaseFinder(),
    saleFinder: new SaleFinder(),
  });
  return { app, merchantId, authorize };
}

afterEach(() => vi.restoreAllMocks());

describe("Realtime subscription membership", () => {
  it.each([
    { membership: "disabled" as const, errorCode: "forbidden_error" },
    { membership: null, errorCode: "account_not_provisioned" },
  ])("denies $membership database membership before signing", async ({ membership, errorCode }) => {
    const { app, merchantId, authorize } = await setupRoute(membership);

    const response = await app.request("/v1/realtime/subscriptions", {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ socket_id: "123.456", channel_name: `private-${merchantId}` }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: errorCode });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("signs for the enabled staff merchant from the database despite different token metadata", async () => {
    const { app, merchantId, authorize } = await setupRoute("enabled");

    const response = await app.request("/v1/realtime/subscriptions", {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ socket_id: "123.456", channel_name: `private-${merchantId}` }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ auth: expect.stringMatching(/^test-key:[a-f0-9]{64}$/) });
    expect(authorize).toHaveBeenCalledExactlyOnceWith({ socketId: "123.456", channelName: `private-${merchantId}` });
  });
});
