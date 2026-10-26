import { Hono } from "hono";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { CurrentUser } from "./contracts/current-user.ts";
import type { JsonWebTokenPayload } from "./contracts/json-web-token-payload.ts";
import type { Database } from "./db/index.ts";
import type { CollectionFinder } from "./finders/collection-finder.ts";
import type { CustomerFinder } from "./finders/customer-finder.ts";
import type { LocationFinder } from "./finders/location-finder.ts";
import type { MerchantFinder } from "./finders/merchant-finder.ts";
import type { PurchaseFinder } from "./finders/purchase-finder.ts";
import type { SaleFinder } from "./finders/sale-finder.ts";
import type { ProductFinder } from "./finders/product-finder.ts";
import type { SupplierFinder } from "./finders/supplier-finder.ts";
import type { EnvVars } from "./infra/config.env.ts";
import type { IdentityProvider } from "./integrations/identity-provider.ts";
import type { RealtimeEventPublisher } from "./integrations/realtime-event-publisher.ts";

type MipymeEnv = {
  Variables: {
    requestId: string;
    logger: Logger;
    env: EnvVars;
    db: Database;
    cache: Redis;
    identity: IdentityProvider;
    publisher: RealtimeEventPublisher;
    merchantFinder: MerchantFinder;
    collectionFinder: CollectionFinder;
    customerFinder: CustomerFinder;
    locationFinder: LocationFinder;
    supplierFinder: SupplierFinder;
    productFinder: ProductFinder;
    purchaseFinder: PurchaseFinder;
    saleFinder: SaleFinder;
    claims: JsonWebTokenPayload;
    user: CurrentUser;
  };
};

class MipymeHono extends Hono<MipymeEnv> {}

export { MipymeHono, type MipymeEnv };
