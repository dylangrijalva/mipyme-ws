import { eq } from "drizzle-orm";
import pino from "pino";
import { vi } from "vitest";
import type { CurrentUser } from "../../src/contracts/current-user.ts";
import type { IdentityAccount } from "../../src/contracts/identity-account.ts";
import type { Database } from "../../src/db/index.ts";
import { tables } from "../../src/db/schema.ts";
import { EmployeeFinder } from "../../src/finders/employee-finder.ts";
import { InvitationFinder } from "../../src/finders/invitation-finder.ts";
import { MerchantFinder } from "../../src/finders/merchant-finder.ts";
import { EmailSender } from "../../src/integrations/email-sender.ts";
import type { IdentityProvider } from "../../src/integrations/identity-provider.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { ok } from "../../src/utils/result.ts";
import { EmployeeManagement } from "../../src/services/employee-management.ts";
import { prepareDatabase } from "../prepare-db.ts";
import { createRealtimeEnv } from "./realtime-env.ts";
import { createRealtimeEventPublisherMock } from "./realtime-publisher-mock.ts";
import { EmployeeAuthorizationService } from "../../src/services/employee-authorization-service.ts";

const NOW = new Date("2026-05-10T15:00:00.000Z");
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const IDENTITY_ACCOUNT: IdentityAccount = {
  id: "user_nami",
  name: "Nami",
  email: "nami@strawhatpirates.example.com",
  pictureUrl: "https://strawhatpirates.example.com/nami.png",
  publicMetadata: {},
};

type EmployeeValues = typeof tables.employee.$inferInsert;
type InvitationValues = typeof tables.employeeInvitation.$inferInsert;

async function setupEmployees() {
  const db = await prepareDatabase();
  vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());

  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Baratie Market", country: "co" },
    { id: otherMerchantId, name: "Heart Pirates", country: "bz" },
  ]);

  const waterSevenId = generateId({ model: "location" });
  const loguetownId = generateId({ model: "location" });
  const foreignLocationId = generateId({ model: "location" });
  await db.insert(tables.location).values([
    { id: waterSevenId, merchantId, name: "Water 7" },
    { id: loguetownId, merchantId, name: "Loguetown" },
    { id: foreignLocationId, merchantId: otherMerchantId, name: "Polar Tang" },
  ]);

  const ownerAccountId = generateId({ model: "account" });
  await db.insert(tables.account).values({
    id: ownerAccountId,
    merchantId,
    externalId: "user_luffy",
    email: "luffy@strawhatpirates.example.com",
  });

  const ownerId = generateId({ model: "employee" });
  const managerId = generateId({ model: "employee" });
  const cashierId = generateId({ model: "employee" });
  const foreignEmployeeId = generateId({ model: "employee" });
  const createdAt = new Date(NOW.getTime() - DAY_IN_MS);
  await db.insert(tables.employee).values([
    {
      id: ownerId,
      merchantId,
      accountId: ownerAccountId,
      name: "Monkey D. Luffy",
      isOwner: true,
      status: "enabled",
      pin: "0001",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: managerId,
      merchantId,
      name: "Roronoa Zoro",
      status: "enabled",
      pin: "1111",
      permissions: "manage_employees checkout",
      maxDiscountRate: "0.20",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: cashierId,
      merchantId,
      name: "Nami",
      status: "enabled",
      pin: "4821",
      permissions: "checkout",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: foreignEmployeeId,
      merchantId: otherMerchantId,
      name: "Trafalgar Law",
      isOwner: true,
      status: "enabled",
      pin: "7777",
      createdAt,
      updatedAt: createdAt,
    },
  ]);

  const createUser = (employeeId: string, accountType: CurrentUser["accountType"]): CurrentUser => ({
    id: generateId({ model: "account" }),
    email: "crew@strawhatpirates.example.com",
    merchantId,
    employeeId,
    accountType,
  });
  const owner = { ...createUser(ownerId, "owner"), id: ownerAccountId, email: "luffy@strawhatpirates.example.com" };
  const manager = createUser(managerId, "staff");
  const cashier = createUser(cashierId, "staff");

  const { publisher, broadcast } = createRealtimeEventPublisherMock();
  const identity = {
    assignToMerchant: vi.fn<IdentityProvider["assignToMerchant"]>().mockResolvedValue(ok(IDENTITY_ACCOUNT)),
    removeFromMerchant: vi.fn<IdentityProvider["removeFromMerchant"]>().mockResolvedValue(ok(IDENTITY_ACCOUNT)),
  };
  const logger = pino({ enabled: false });
  const emailSender = new EmailSender({ env: createRealtimeEnv(), logger });
  const sendEmployeeInvitation = vi
    .spyOn(emailSender, "sendEmployeeInvitation")
    .mockReturnValue(new Promise<void>(() => {}));

  const dependencies = (user: CurrentUser) => ({
    logger,
    db,
    user,
    publisher,
    emailSender,
    identity: identity as unknown as IdentityProvider,
    employeeFinder: new EmployeeFinder(),
    invitationFinder: new InvitationFinder(),
    merchantFinder: new MerchantFinder(),
    employeeManagement: new EmployeeManagement(EmployeeAuthorizationService.create({ db })),
  });

  return {
    db,
    merchantId,
    otherMerchantId,
    waterSevenId,
    loguetownId,
    foreignLocationId,
    ownerAccountId,
    ownerId,
    managerId,
    cashierId,
    foreignEmployeeId,
    owner,
    manager,
    cashier,
    broadcast,
    identity,
    sendEmployeeInvitation,
    dependencies,
  };
}

async function insertEmployee(db: Database, values: Omit<EmployeeValues, "id"> & { id?: string }): Promise<string> {
  const id = values.id ?? generateId({ model: "employee" });
  await db.insert(tables.employee).values({ ...values, id });
  return id;
}

async function insertInvitation(
  db: Database,
  values: Omit<InvitationValues, "id" | "expiresAt"> & { id?: string; expiresAt?: Date },
): Promise<string> {
  const id = values.id ?? generateId({ model: "employeeInvitation" });
  await db.insert(tables.employeeInvitation).values({
    ...values,
    id,
    expiresAt: values.expiresAt ?? new Date(NOW.getTime() + 7 * DAY_IN_MS),
    createdAt: values.createdAt ?? NOW,
    updatedAt: values.updatedAt ?? NOW,
  });
  return id;
}

async function readEmployee(db: Database, id: string) {
  const [employee] = await db.select().from(tables.employee).where(eq(tables.employee.id, id));
  return employee;
}

async function readState(db: Database) {
  const [employees, accounts, invitations, locationAccess] = await Promise.all([
    db.select().from(tables.employee).orderBy(tables.employee.id),
    db.select().from(tables.account).orderBy(tables.account.id),
    db.select().from(tables.employeeInvitation).orderBy(tables.employeeInvitation.id),
    db.select().from(tables.locationAccess).orderBy(tables.locationAccess.id),
  ]);
  return { employees, accounts, invitations, locationAccess };
}

export { DAY_IN_MS, IDENTITY_ACCOUNT, insertEmployee, insertInvitation, NOW, readEmployee, readState, setupEmployees };
