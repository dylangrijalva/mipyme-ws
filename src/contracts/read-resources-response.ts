import z from "zod";
import { Collection } from "./collection.ts";
import { Customer } from "./customer.ts";
import { Employee } from "./employee.ts";
import { Location } from "./location.ts";
import { Merchant } from "./merchant.ts";
import { Product } from "./product.ts";
import { Supplier } from "./supplier.ts";

const ReadResourcesResponse = z.object({
  syncToken: z.string(),
  fullSync: z.boolean(),
  merchant: Merchant.nullable(),
  products: Product.array(),
  collections: Collection.array(),
  customers: Customer.array(),
  employees: Employee.array(),
  locations: Location.array(),
  suppliers: Supplier.array(),
});

type ReadResourcesResponse = z.infer<typeof ReadResourcesResponse>;

export { ReadResourcesResponse };
