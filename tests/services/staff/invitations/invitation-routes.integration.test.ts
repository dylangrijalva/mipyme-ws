import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../src/app.ts";
import { tables } from "../../../../src/db/schema.ts";
import { CollectionFinder } from "../../../../src/finders/collection-finder.ts";
import { CustomerFinder } from "../../../../src/finders/customer-finder.ts";
import { EmployeeFinder } from "../../../../src/finders/employee-finder.ts";
import { InvitationFinder } from "../../../../src/finders/invitation-finder.ts";
import { LocationFinder } from "../../../../src/finders/location-finder.ts";
import { MerchantFinder } from "../../../../src/finders/merchant-finder.ts";
import { ProductFinder } from "../../../../src/finders/product-finder.ts";
import { PurchaseFinder } from "../../../../src/finders/purchase-finder.ts";
import { SaleFinder } from "../../../../src/finders/sale-finder.ts";
import { SupplierFinder } from "../../../../src/finders/supplier-finder.ts";
import { EmailSender } from "../../../../src/integrations/email-sender.ts";
import { IdentityProvider } from "../../../../src/integrations/identity-provider.ts";
import { ProductImageStore } from "../../../../src/integrations/product-image-store.ts";
import { RealtimeEventPublisher } from "../../../../src/integrations/realtime-event-publisher.ts";
import { EmployeeManagement } from "../../../../src/services/employee-management.ts";
import { InventoryManagement } from "../../../../src/services/inventory-management.ts";
import { ok } from "../../../../src/utils/result.ts";
import { IDENTITY_ACCOUNT, insertInvitation, setupEmployees } from "../../../test-utils/employee-fixture.ts";
import { createRealtimeEnv } from "../../../test-utils/realtime-env.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

async function setupRoutes() {
  const context = await setupEmployees();
  const invitationId = await insertInvitation(context.db, {
    merchantId: context.merchantId,
    employeeId: context.cashierId,
    invitedById: context.managerId,
    email: "nami@strawhatpirates.example.com",
    status: "invited",
  });
  const env = createRealtimeEnv();
  const logger = pino({ enabled: false });
  const identity = new IdentityProvider(logger, env);
  vi.spyOn(identity, "verifyToken").mockResolvedValue(
    ok({ sub: "user_nami", email: "nami@strawhatpirates.example.com" }),
  );
  const assignToMerchant = vi.spyOn(identity, "assignToMerchant").mockResolvedValue(ok(IDENTITY_ACCOUNT));
  const cache = new Redis(env.REDIS_URL, { lazyConnect: true });
  vi.spyOn(cache, "eval").mockResolvedValue(1);
  vi.spyOn(cache, "ttl").mockResolvedValue(60);
  const app = createApp({
    logger,
    env,
    db: context.db,
    cache,
    identity,
    emailSender: new EmailSender({ env, logger }),
    employeeManagement: new EmployeeManagement(),
    inventoryManagement: new InventoryManagement(),
    productImageStore: new ProductImageStore({ env, logger }),
    publisher: new RealtimeEventPublisher({ env, logger }),
    merchantFinder: new MerchantFinder(),
    collectionFinder: new CollectionFinder(),
    customerFinder: new CustomerFinder(),
    employeeFinder: new EmployeeFinder(),
    invitationFinder: new InvitationFinder(),
    locationFinder: new LocationFinder(),
    supplierFinder: new SupplierFinder(),
    productFinder: new ProductFinder(),
    purchaseFinder: new PurchaseFinder(),
    saleFinder: new SaleFinder(),
  });
  const request = (path: string, method = "GET") =>
    app.request(path, { method, headers: { Authorization: "Bearer test-token" } });
  return { ...context, invitationId, assignToMerchant, request };
}

describe("Invitation routes", () => {
  it("lets a login without a business list its invitation and accept it, after which it is a member", async () => {
    const { db, merchantId, cashierId, invitationId, assignToMerchant, request } = await setupRoutes();

    const membershipBefore = await request("/v1/employees");
    const listed = await request("/v1/invitations");
    const accepted = await request(`/v1/invitations/${invitationId}/accept`, "POST");
    const membershipAfter = await request("/v1/employees");

    expect(membershipBefore.status).toBe(403);
    expect(await membershipBefore.json()).toMatchObject({ code: "account_not_provisioned" });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      results: [
        {
          id: invitationId,
          status: "invited",
          merchant: { id: merchantId, name: "Baratie Market" },
          employee: { id: cashierId, name: "Nami" },
        },
      ],
      next_cursor: null,
      has_more: false,
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      id: cashierId,
      account: { email: "nami@strawhatpirates.example.com" },
      invitation: { id: invitationId, status: "accepted" },
    });
    const [account] = await db.select().from(tables.account).where(eq(tables.account.externalId, "user_nami"));
    expect(account).toMatchObject({ merchantId });
    expect(assignToMerchant).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ accountId: "user_nami", employeeId: cashierId, accountType: "staff" }),
    );
    expect(membershipAfter.status).toBe(200);
  });
});
