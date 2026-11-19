import { sql } from "drizzle-orm";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes, type BusinessError } from "../../../src/contracts/business-error.ts";
import type { IdentityAccount } from "../../../src/contracts/identity-account.ts";
import type { Database } from "../../../src/db/index.ts";
import { tables } from "../../../src/db/schema.ts";
import { MerchantFinder } from "../../../src/finders/merchant-finder.ts";
import type { IdentityProvider } from "../../../src/integrations/identity-provider.ts";
import {
  OnboardAccountRequest,
  ProvisionAccountService,
} from "../../../src/services/onboarding/provision-account-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { err, ok } from "../../../src/utils/result.ts";
import { prepareDatabase } from "../../prepare-db.ts";

const IDENTITY_ACCOUNT: IdentityAccount = {
  id: "user_luffy",
  name: "Luffy",
  email: "luffy@strawhatpirates.example.com",
  phoneNumbers: [],
  pictureUrl: "https://strawhatpirates.example.com/luffy.png",
  publicMetadata: {},
};

const REQUEST: OnboardAccountRequest = {
  name: "Monkey D. Luffy",
  phone: "+593987654321",
  country: "ni",
  location: { name: "Straw Hat Pirates", businessType: "restaurant" },
};

const PHONE_NUMBER_ALREADY_EXISTS: BusinessError = {
  code: codes.phoneNumberAlreadyExists,
  message: "The phone number is already in use by another account.",
  details: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  const db = await prepareDatabase();
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-15T12:00:00Z").getTime());
  const identity = {
    find: vi.fn<IdentityProvider["find"]>().mockResolvedValue(ok(IDENTITY_ACCOUNT)),
    assignToMerchant: vi.fn<IdentityProvider["assignToMerchant"]>().mockResolvedValue(ok(IDENTITY_ACCOUNT)),
    addPhoneNumber: vi.fn<IdentityProvider["addPhoneNumber"]>().mockResolvedValue(ok(undefined)),
  };
  const service = ProvisionAccountService.create({
    logger: pino({ enabled: false }),
    db,
    identity: identity as unknown as IdentityProvider,
    merchantFinder: new MerchantFinder(),
    claims: { sub: IDENTITY_ACCOUNT.id, email: "old.luffy@strawhatpirates.example.com" },
  });

  return { db, identity, service };
}

async function readState(db: Database) {
  const [merchants, accounts, employees, locations] = await Promise.all([
    db.select().from(tables.merchant).orderBy(tables.merchant.id),
    db.select().from(tables.account).orderBy(tables.account.id),
    db.select().from(tables.employee).orderBy(tables.employee.id),
    db.select().from(tables.location).orderBy(tables.location.id),
  ]);

  return { merchants, accounts, employees, locations };
}

async function seedBusiness(db: Database, isOwner = true, externalId = "user_law", phone: string | null = null) {
  const merchantId = generateId({ model: "merchant" });
  const accountId = generateId({ model: "account" });
  const employeeId = generateId({ model: "employee" });

  await db.insert(tables.merchant).values({ id: merchantId, name: "Heart Pirates", country: "cr" });
  await db.insert(tables.account).values({
    id: accountId,
    merchantId,
    externalId,
    email: externalId === IDENTITY_ACCOUNT.id ? IDENTITY_ACCOUNT.email! : "law@heartpirates.example.com",
    phone,
  });
  await db.insert(tables.employee).values({
    id: employeeId,
    merchantId,
    accountId,
    name: externalId === IDENTITY_ACCOUNT.id ? IDENTITY_ACCOUNT.name : "Trafalgar Law",
    isOwner,
    status: "enabled",
    permissions: "sales:read",
  });
  await db.insert(tables.location).values({
    id: generateId({ model: "location" }),
    merchantId,
    name: "Polar Tang",
    businessType: "pharmacy",
    address: "Sabaody Archipelago",
    nextSaleNumber: 42,
  });

  return { merchantId, accountId, employeeId };
}

describe("ProvisionAccountService", () => {
  it("creates a merchant, account, enabled owner, and location without changing another business", async () => {
    const { db, identity, service } = await setup();
    await seedBusiness(db);
    const before = await readState(db);

    const result = await service.execute(REQUEST);

    expect(result.success).toBe(true);
    const after = await readState(db);
    expect(after.merchants).toHaveLength(2);
    expect(after.accounts).toHaveLength(2);
    expect(after.employees).toHaveLength(2);
    expect(after.locations).toHaveLength(2);
    expect(after.merchants).toEqual(expect.arrayContaining(before.merchants));
    expect(after.accounts).toEqual(expect.arrayContaining(before.accounts));
    expect(after.employees).toEqual(expect.arrayContaining(before.employees));
    expect(after.locations).toEqual(expect.arrayContaining(before.locations));
    const merchant = after.merchants.find((record) => record.id === result.value?.id)!;
    const account = after.accounts.find((record) => record.merchantId === merchant.id)!;
    const employee = after.employees.find((record) => record.merchantId === merchant.id)!;
    const location = after.locations.find((record) => record.merchantId === merchant.id)!;
    expect(result).toEqual(ok(merchant));
    expect(merchant).toMatchObject({ name: "Straw Hat Pirates", country: "ni" });
    expect(account).toMatchObject({ externalId: "user_luffy", email: IDENTITY_ACCOUNT.email, phone: "+593987654321" });
    expect(employee).toMatchObject({
      accountId: account.id,
      name: "Monkey D. Luffy",
      isOwner: true,
      status: "enabled",
    });
    expect(location).toMatchObject({ name: "Straw Hat Pirates", businessType: "restaurant" });
    expect(identity.find).toHaveBeenCalledExactlyOnceWith("user_luffy");
    expect(identity.addPhoneNumber).toHaveBeenCalledExactlyOnceWith({
      accountId: "user_luffy",
      phoneNumber: "+593987654321",
    });
    expect(identity.assignToMerchant).toHaveBeenCalledExactlyOnceWith({
      accountId: "user_luffy",
      merchantId: merchant.id,
      employeeId: employee.id,
      name: "Monkey D. Luffy",
      accountType: "owner",
    });
  });

  it("reuses an existing owner's records and name when provisioning is repeated with different input", async () => {
    const { db, identity, service } = await setup();
    const first = await service.execute(REQUEST);
    expect(first.success).toBe(true);
    await seedBusiness(db);
    const before = await readState(db);
    identity.assignToMerchant.mockClear();
    identity.addPhoneNumber.mockClear();
    identity.find.mockResolvedValue(ok({ ...IDENTITY_ACCOUNT, email: "captain@strawhatpirates.example.com" }));

    vi.mocked(Date.now).mockReturnValue(new Date("2026-01-16T12:00:00Z").getTime());

    const result = await service.execute({
      name: "Captain Luffy",
      phone: "+573001234567",
      country: "cr",
      location: { name: "Thousand Sunny", businessType: "grocery_store" },
    });

    expect(result).toEqual(first);
    expect(await readState(db)).toEqual(before);
    expect(identity.addPhoneNumber).not.toHaveBeenCalled();
    const employee = before.employees.find((record) => record.merchantId === first.value?.id)!;
    expect(identity.assignToMerchant).toHaveBeenCalledExactlyOnceWith({
      accountId: "user_luffy",
      merchantId: first.value?.id,
      employeeId: employee.id,
      name: "Monkey D. Luffy",
      accountType: "owner",
    });
  });

  it("rejects a phone number owned by another account without contacting Clerk or creating records", async () => {
    const { db, identity, service } = await setup();
    await seedBusiness(db, true, "user_law", REQUEST.phone);
    const before = await readState(db);

    const result = await service.execute(REQUEST);

    expect(result).toEqual(err(PHONE_NUMBER_ALREADY_EXISTS));
    expect(await readState(db)).toEqual(before);
    expect(identity.addPhoneNumber).not.toHaveBeenCalled();
    expect(identity.assignToMerchant).not.toHaveBeenCalled();
  });

  it("returns Clerk's rejection of the phone number without creating records", async () => {
    const { db, identity, service } = await setup();
    await seedBusiness(db);
    const before = await readState(db);
    identity.addPhoneNumber.mockResolvedValue(err(PHONE_NUMBER_ALREADY_EXISTS));

    const result = await service.execute(REQUEST);

    expect(result).toEqual(err(PHONE_NUMBER_ALREADY_EXISTS));
    expect(await readState(db)).toEqual(before);
    expect(identity.assignToMerchant).not.toHaveBeenCalled();
  });

  it("stores the phone number without adding it to Clerk again when the identity already has it", async () => {
    const { db, identity, service } = await setup();
    identity.find.mockResolvedValue(ok({ ...IDENTITY_ACCOUNT, phoneNumbers: ["+593987654321"] }));

    const result = await service.execute(REQUEST);

    expect(result.success).toBe(true);
    const { accounts } = await readState(db);
    expect(accounts).toEqual([expect.objectContaining({ externalId: "user_luffy", phone: "+593987654321" })]);
    expect(identity.addPhoneNumber).not.toHaveBeenCalled();
    expect(identity.assignToMerchant).toHaveBeenCalledOnce();
  });

  it("provisions the business when Clerk reports the number as taken because the same owner just added it", async () => {
    const { db, identity, service } = await setup();
    identity.find
      .mockResolvedValueOnce(ok(IDENTITY_ACCOUNT))
      .mockResolvedValueOnce(ok({ ...IDENTITY_ACCOUNT, phoneNumbers: ["+593987654321"] }));
    identity.addPhoneNumber.mockResolvedValue(err(PHONE_NUMBER_ALREADY_EXISTS));

    const result = await service.execute(REQUEST);

    const state = await readState(db);
    expect(result).toEqual(ok(state.merchants[0]));
    expect(state.accounts).toEqual([expect.objectContaining({ externalId: "user_luffy", phone: "+593987654321" })]);
    expect(identity.find).toHaveBeenNthCalledWith(2, "user_luffy");
    expect(identity.assignToMerchant).toHaveBeenCalledOnce();
  });

  it("rejects the signup without creating records when a concurrent signup claims the phone number first", async () => {
    const { db, identity, service } = await setup();
    identity.addPhoneNumber.mockImplementation(async () => {
      await seedBusiness(db, true, "user_zoro", REQUEST.phone);
      return ok(undefined);
    });

    const result = await service.execute(REQUEST);

    expect(result).toEqual(err(PHONE_NUMBER_ALREADY_EXISTS));
    const state = await readState(db);
    expect(state.merchants).toEqual([expect.objectContaining({ name: "Heart Pirates" })]);
    expect(state.accounts).toEqual([expect.objectContaining({ externalId: "user_zoro", phone: REQUEST.phone })]);
    expect(state.employees).toHaveLength(1);
    expect(state.locations).toHaveLength(1);
    expect(identity.assignToMerchant).not.toHaveBeenCalled();
  });

  it("rejects an existing non-owner without changing records or assigning owner privileges", async () => {
    const { db, identity, service } = await setup();
    await seedBusiness(db, false, IDENTITY_ACCOUNT.id);
    const before = await readState(db);

    const result = await service.execute(REQUEST);

    expect(result).toEqual(
      err({
        code: codes.conflictError,
        message: "This account already belongs to an employee and cannot provision a business.",
        details: [],
      }),
    );
    expect(await readState(db)).toEqual(before);
    expect(identity.assignToMerchant).not.toHaveBeenCalled();
  });

  it("returns an identity lookup failure without creating records or assigning a merchant", async () => {
    const { db, identity, service } = await setup();
    await seedBusiness(db);
    const before = await readState(db);
    const error: BusinessError = {
      code: codes.resourceNotFound,
      message: "The provided account doesn't exist in our platform.",
      details: [],
    };
    identity.find.mockResolvedValue(err(error));

    const result = await service.execute(REQUEST);

    expect(result).toEqual(err(error));
    expect(await readState(db)).toEqual(before);
    expect(identity.assignToMerchant).not.toHaveBeenCalled();
  });

  it("keeps committed records after assignment fails and reuses them on a successful retry", async () => {
    const { db, identity, service } = await setup();
    const error: BusinessError = {
      code: codes.rateLimitExceeded,
      message: "Too many account requests. Please wait and try again.",
      details: [],
    };
    identity.assignToMerchant.mockResolvedValueOnce(err(error));

    const failed = await service.execute(REQUEST);

    expect(failed).toEqual(err(error));
    const committed = await readState(db);
    expect(committed.merchants).toHaveLength(1);
    expect(committed.accounts).toHaveLength(1);
    expect(committed.employees).toHaveLength(1);
    expect(committed.locations).toHaveLength(1);

    const retried = await service.execute(REQUEST);

    expect(retried).toEqual(ok(committed.merchants[0]));
    expect(await readState(db)).toEqual(committed);
    expect(identity.addPhoneNumber).toHaveBeenCalledOnce();
    expect(identity.assignToMerchant).toHaveBeenCalledTimes(2);
    for (const call of identity.assignToMerchant.mock.calls) {
      expect(call).toEqual([
        {
          accountId: "user_luffy",
          merchantId: committed.merchants[0].id,
          employeeId: committed.employees[0].id,
          name: "Monkey D. Luffy",
          accountType: "owner",
        },
      ]);
    }
  });

  it("rolls back the merchant when the identity account has no email", async () => {
    const { db, identity, service } = await setup();
    await seedBusiness(db);
    const before = await readState(db);
    identity.find.mockResolvedValue(ok({ ...IDENTITY_ACCOUNT, email: null }));

    const result = service.execute(REQUEST);

    await expect(result).rejects.toMatchObject({ cause: { code: "ER_BAD_NULL_ERROR" } });
    expect(await readState(db)).toEqual(before);
    expect(identity.assignToMerchant).not.toHaveBeenCalled();
  });

  it("rolls back the merchant, account, and owner when location persistence fails", async () => {
    const { db, identity, service } = await setup();
    await seedBusiness(db);
    const before = await readState(db);
    await db.execute(sql`
      CREATE TRIGGER reject_provisioned_location BEFORE INSERT ON locations
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Location storage unavailable'
    `);

    try {
      const result = service.execute(REQUEST);

      await expect(result).rejects.toMatchObject({
        cause: { sqlState: "45000", sqlMessage: "Location storage unavailable" },
      });
      expect(await readState(db)).toEqual(before);
      expect(identity.assignToMerchant).not.toHaveBeenCalled();
    } finally {
      await db.execute(sql`DROP TRIGGER reject_provisioned_location`);
    }
  });

  it("creates only one business when the same account is provisioned concurrently", async () => {
    const { db, identity, service } = await setup();
    await db.execute(sql`
      CREATE TRIGGER wait_for_competing_provision BEFORE INSERT ON merchants
      FOR EACH ROW BEGIN
        DO GET_LOCK('provision_account_creation', 10);
        DO RELEASE_LOCK('provision_account_creation');
      END
    `);

    const results = await (async () => {
      try {
        return await db.transaction(async (lock) => {
          await lock.execute(sql`SELECT GET_LOCK('provision_account_creation', 10)`);
          const attempts = Promise.allSettled([service.execute(REQUEST), service.execute(REQUEST)]);

          try {
            await expect
              .poll(
                async () => {
                  const [state] = await db
                    .select({ waiting: sql<number>`count(*)`.mapWith(Number) })
                    .from(sql`performance_schema.metadata_locks`).where(sql`
                      OBJECT_TYPE = 'USER LEVEL LOCK'
                      AND OBJECT_NAME = 'provision_account_creation'
                      AND LOCK_STATUS = 'PENDING'
                    `);
                  return state.waiting;
                },
                { timeout: 5_000 },
              )
              .toBe(2);
          } finally {
            await lock.execute(sql`SELECT RELEASE_LOCK('provision_account_creation')`);
            await attempts;
          }

          return attempts;
        });
      } finally {
        await db.execute(sql`DROP TRIGGER wait_for_competing_provision`);
      }
    })();

    const state = await readState(db);
    expect(state.merchants).toHaveLength(1);
    expect(state.accounts).toHaveLength(1);
    expect(state.employees).toHaveLength(1);
    expect(state.locations).toHaveLength(1);
    expect(results).toEqual([
      { status: "fulfilled", value: ok(state.merchants[0]) },
      { status: "fulfilled", value: ok(state.merchants[0]) },
    ]);
    expect(state.accounts[0].merchantId).toBe(state.merchants[0].id);
    expect(state.employees[0]).toMatchObject({
      merchantId: state.merchants[0].id,
      accountId: state.accounts[0].id,
      isOwner: true,
    });
    expect(state.locations[0].merchantId).toBe(state.merchants[0].id);
    expect(identity.assignToMerchant).toHaveBeenCalledTimes(2);
    for (const call of identity.assignToMerchant.mock.calls) {
      expect(call).toEqual([
        {
          accountId: "user_luffy",
          merchantId: state.merchants[0].id,
          employeeId: state.employees[0].id,
          name: "Monkey D. Luffy",
          accountType: "owner",
        },
      ]);
    }
  }, 15_000);
});

describe("OnboardAccountRequest", () => {
  it.each([
    ["the shortest E.164 number", "+12345678"],
    ["the longest E.164 number", "+123456789012345"],
    ["an Ecuadorian mobile number", "+593987654321"],
  ])("accepts %s", (_scenario, phone) => {
    const result = OnboardAccountRequest.safeParse({ ...REQUEST, phone });

    expect(result.data?.phone).toBe(phone);
  });

  it("trims whitespace around the phone number", () => {
    const result = OnboardAccountRequest.safeParse({ ...REQUEST, phone: " +593987654321 " });

    expect(result.data?.phone).toBe("+593987654321");
  });

  it.each([
    ["is missing", undefined],
    ["is a national number", "0987654321"],
    ["contains spaces", "+593 98 765 4321"],
    ["starts the country code with zero", "+0593987654321"],
    ["is too short", "+1234567"],
    ["is too long", "+1234567890123456"],
  ])("rejects a phone number that %s", (_scenario, phone) => {
    const result = OnboardAccountRequest.safeParse({ ...REQUEST, phone });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ["phone"] })]);
  });
});
