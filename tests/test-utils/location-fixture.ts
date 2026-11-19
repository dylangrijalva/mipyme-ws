import pino from "pino";
import type { CurrentUser } from "../../src/contracts/current-user.ts";
import { tables } from "../../src/db/schema.ts";
import { LocationFinder } from "../../src/finders/location-finder.ts";
import { generateId } from "../../src/utils/generate-id.ts";
import { prepareDatabase } from "../prepare-db.ts";
import { createRealtimeEventPublisherMock } from "./realtime-publisher-mock.ts";

async function setupLocations(accountType: CurrentUser["accountType"] = "owner") {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const employeeId = generateId({ model: "employee" });
  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.employee).values({
    id: employeeId,
    merchantId,
    name: "Nami",
    isOwner: accountType === "owner",
    status: "enabled",
    pin: "4821",
  });
  const user: CurrentUser = {
    id: generateId({ model: "account" }),
    employeeId,
    merchantId,
    email: "nami@strawhatpirates.example.com",
    accountType,
  };
  const { publisher, broadcast } = createRealtimeEventPublisherMock();
  const dependencies = { db, user, publisher, locationFinder: new LocationFinder(), logger: pino({ enabled: false }) };
  return { ...dependencies, dependencies, otherMerchantId, merchantId, employeeId, broadcast };
}

export { setupLocations };
