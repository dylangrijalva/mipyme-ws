import z from "zod";
import { codes, type BusinessError } from "./business-error.ts";
import { Collection } from "./collection.ts";
import { Customer } from "./customer.ts";
import { Employee } from "./employee.ts";
import { Location } from "./location.ts";
import { Merchant } from "./merchant.ts";
import { Product } from "./product.ts";
import { Supplier } from "./supplier.ts";

const SyncRequest = z.object({
  syncToken: z.string().min(1).max(2048),
});

const SyncResources = z.object({
  merchant: Merchant.nullable(),
  products: Product.array(),
  collections: Collection.array(),
  customers: Customer.array(),
  suppliers: Supplier.array(),
  locations: Location.array(),
  employees: Employee.array(),
});

const SyncResponse = SyncResources.extend({
  fullSync: z.boolean(),
  syncToken: z.string(),
});

type SyncRequest = z.infer<typeof SyncRequest>;
type SyncResources = z.infer<typeof SyncResources>;
type SyncResponse = z.infer<typeof SyncResponse>;

const SYNC_UNAVAILABLE: BusinessError = {
  code: codes.syncUnavailable,
  message: "Sync is temporarily unavailable. Retry with the same sync token.",
  details: [],
};

export { SyncRequest, SyncResources, SyncResponse, SYNC_UNAVAILABLE };
