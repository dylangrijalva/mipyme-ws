import { eq } from "drizzle-orm";
import { contextStorage } from "hono/context-storage";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../src/contracts/business-error.ts";
import type { Employee } from "../../src/contracts/employee.ts";
import type { Database } from "../../src/db/index.ts";
import { tables } from "../../src/db/schema.ts";
import { CollectionFinder } from "../../src/finders/collection-finder.ts";
import { MerchantFinder } from "../../src/finders/merchant-finder.ts";
import { ProductFinder } from "../../src/finders/product-finder.ts";
import { membershipGuard } from "../../src/guards/membership-guard.ts";
import type { IdentityProvider } from "../../src/integrations/identity-provider.ts";
import { authorize } from "../../src/middlewares/authorize.ts";
import { errorHandler } from "../../src/middlewares/error-handler.ts";
import { onboardingRouter } from "../../src/routes/onboarding.router.ts";
import { productsRouter } from "../../src/routes/products.router.ts";
import { FacilitoHono } from "../../src/types.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { err, ok } from "../../src/utils/result.ts";
import { prepareDatabase } from "../prepare-db.ts";

const IDENTITY_ACCOUNT = {
  id: "user_luffy",
  name: "Monkey D. Luffy",
  email: "luffy@strawhatpirates.example.com",
  pictureUrl: "https://strawhatpirates.example.com/luffy.png",
  publicMetadata: {},
};
const PRODUCT = { name: "Chopper's consultation", productType: "service", price: "10.00" };

function post(body: unknown, authenticated = true): Parameters<FacilitoHono["request"]>[1] {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer luffy-token" } : {}) },
    body: JSON.stringify(body),
  };
}

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const db = await prepareDatabase();
  const identity = {
    verifyToken: vi.fn<IdentityProvider["verifyToken"]>().mockResolvedValue(
      ok({
        sub: IDENTITY_ACCOUNT.id,
        email: "old.luffy@strawhatpirates.example.com",
        merchantId: "untrusted-merchant",
        employeeId: "untrusted-employee",
        accountType: "internal",
      }),
    ),
    find: vi.fn<IdentityProvider["find"]>().mockResolvedValue(ok(IDENTITY_ACCOUNT)),
    assignToMerchant: vi.fn<IdentityProvider["assignToMerchant"]>().mockResolvedValue(ok(IDENTITY_ACCOUNT)),
  };
  const app = new FacilitoHono();
  app.use(contextStorage());
  app.use(async (ctx, next) => {
    ctx.set("db", db);
    ctx.set("logger", pino({ enabled: false }));
    ctx.set("requestId", "membership-test");
    // Only the external identity provider is replaced at its public boundary.
    ctx.set("identity", identity as unknown as IdentityProvider);
    ctx.set("merchantFinder", new MerchantFinder());
    ctx.set("collectionFinder", new CollectionFinder());
    ctx.set("productFinder", new ProductFinder());
    await next();
  });
  app.onError(errorHandler());
  app.route("/v1/products", productsRouter());
  app.route("/v1/onboarding", onboardingRouter());
  app.get("/current-user", authorize(), membershipGuard(), (ctx) => ctx.json(ctx.var.user));
  return { app, db, identity };
}

async function seedMembership(
  db: Database,
  isOwner: boolean,
  status: Employee["status"] = "enabled",
  externalId = IDENTITY_ACCOUNT.id,
) {
  const merchantId = generateId({ model: "merchant" });
  const id = generateId({ model: "account" });
  const employeeId = generateId({ model: "employee" });
  const email = externalId === IDENTITY_ACCOUNT.id ? IDENTITY_ACCOUNT.email : "law@heartpirates.example.com";
  await db.insert(tables.merchant).values({ id: merchantId, name: "Straw Hat Pirates", country: "ni" });
  await db.insert(tables.account).values({ id, merchantId, externalId, email });
  await db
    .insert(tables.employee)
    .values({ id: employeeId, merchantId, accountId: id, name: "Luffy", isOwner, status });
  return { id, email, merchantId, employeeId, accountType: isOwner ? "owner" : "staff" };
}

describe("membershipGuard", () => {
  it.each([
    { isOwner: true, role: "owner" },
    { isOwner: false, role: "staff" },
  ])("resolves the local $role identity instead of token metadata or another account", async ({ isOwner }) => {
    const { app, db } = await setup();
    await seedMembership(db, true, "enabled", "user_law");
    const user = await seedMembership(db, isOwner);

    const response = await app.request("/current-user", { headers: { Authorization: "Bearer luffy-token" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(user);
  });

  it.each(["missing account", "missing employee"])("rejects %s before product creation", async (scenario) => {
    const { app, db } = await setup();
    await seedMembership(db, true, "enabled", "user_law");
    if (scenario === "missing employee") {
      const user = await seedMembership(db, true);
      await db.delete(tables.employee).where(eq(tables.employee.id, user.employeeId));
    }

    const response = await app.request("/v1/products", post(PRODUCT));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ status: 403, code: "account_not_provisioned", details: [] });
    expect(await db.select().from(tables.product)).toEqual([]);
  });

  it.each(["invited", "disabled"] as const)("rejects an %s employee before product creation", async (status) => {
    const { app, db } = await setup();
    await seedMembership(db, true, status);

    const response = await app.request("/v1/products", post(PRODUCT));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ status: 403, code: "forbidden_error", details: [] });
    expect(await db.select().from(tables.product)).toEqual([]);
  });

  it("uses current employee status on the next request with the same token", async () => {
    const { app, db } = await setup();
    const user = await seedMembership(db, false);
    const first = await app.request("/v1/products", post(PRODUCT));
    expect(first.status).toBe(200);
    const before = await db.select().from(tables.product);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ merchantId: user.merchantId, name: PRODUCT.name });
    await db.update(tables.employee).set({ status: "disabled" }).where(eq(tables.employee.id, user.employeeId));

    const second = await app.request("/v1/products", post(PRODUCT));

    expect(second.status).toBe(403);
    expect(await second.json()).toMatchObject({ code: "forbidden_error" });
    expect(await db.select().from(tables.product)).toEqual(before);
  });

  it.each(["/v1/products", "/v1/onboarding"])(
    "requires authentication at %s before validating the body",
    async (path) => {
      const { app, db } = await setup();

      const response = await app.request(path, post({}, false));

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "invalid_oauth_token" });
      expect(await db.select().from(tables.merchant)).toEqual([]);
      expect(await db.select().from(tables.product)).toEqual([]);
    },
  );

  it("rejects an invalid token even for a provisioned account", async () => {
    const { app, db, identity } = await setup();
    await seedMembership(db, true);
    identity.verifyToken.mockResolvedValue(
      err({ code: codes.invalidOAuthToken, message: "Expired token", details: [] }),
    );

    const response = await app.request("/v1/products", post(PRODUCT));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "invalid_oauth_token" });
    expect(await db.select().from(tables.product)).toEqual([]);
  });

  it("allows an unprovisioned account to onboard and create a product without refreshing token metadata", async () => {
    const { app, db, identity } = await setup();
    identity.verifyToken.mockResolvedValue(ok({ sub: IDENTITY_ACCOUNT.id, email: IDENTITY_ACCOUNT.email }));

    const onboarding = await app.request(
      "/v1/onboarding",
      post({ name: "Luffy", country: "ni", location: { name: "Thousand Sunny", businessType: "restaurant" } }),
    );
    expect(onboarding.status).toBe(200);
    const merchant = await onboarding.json();
    const product = await app.request("/v1/products", post(PRODUCT));

    expect(product.status).toBe(200);
    const [stored] = await db.select().from(tables.product);
    expect(stored).toMatchObject({ merchantId: merchant.id, name: PRODUCT.name });
    const [employee] = await db.select().from(tables.employee);
    expect(employee).toMatchObject({ merchantId: merchant.id, status: "enabled", isOwner: true });
  });

  it("reports database failure as an internal error without running product creation", async () => {
    const { app, db } = await setup();
    vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("Database unavailable");
    });

    const response = await app.request("/v1/products", post(PRODUCT));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "internal_server_error" });
    expect(await db.select().from(tables.product)).toEqual([]);
  });
});
