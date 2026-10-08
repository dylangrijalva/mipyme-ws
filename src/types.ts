import { Hono } from "hono";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { CurrentUser } from "./contracts/current-user.ts";
import type { JsonWebTokenPayload } from "./contracts/json-web-token-payload.ts";
import type { Database } from "./db/index.ts";
import type { CollectionFinder } from "./finders/collection-finder.ts";
import type { MerchantFinder } from "./finders/merchant-finder.ts";
import type { PurchaseFinder } from "./finders/purchase-finder.ts";
import type { ProductFinder } from "./finders/product-finder.ts";
import type { SupplierFinder } from "./finders/supplier-finder.ts";
import type { EnvVars } from "./infra/config.env.ts";
import type { IdentityProvider } from "./integrations/identity-provider.ts";

type FacilitoEnv = {
  Variables: {
    requestId: string;
    logger: Logger;
    env: EnvVars;
    db: Database;
    cache: Redis;
    identity: IdentityProvider;
    merchantFinder: MerchantFinder;
    collectionFinder: CollectionFinder;
    supplierFinder: SupplierFinder;
    productFinder: ProductFinder;
    purchaseFinder: PurchaseFinder;
    claims: JsonWebTokenPayload;
    user: CurrentUser;
  };
};

class FacilitoHono extends Hono<FacilitoEnv> {}

export { FacilitoHono, type FacilitoEnv };
