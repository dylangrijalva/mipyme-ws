import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { SyncRequest, SyncResponse } from "../../contracts/sync.ts";
import type { Database } from "../../db/index.ts";
import type { CollectionFinder } from "../../finders/collection-finder.ts";
import type { CustomerFinder } from "../../finders/customer-finder.ts";
import type { LocationFinder } from "../../finders/location-finder.ts";
import type { MerchantFinder } from "../../finders/merchant-finder.ts";
import type { ProductFinder } from "../../finders/product-finder.ts";
import type { SupplierFinder } from "../../finders/supplier-finder.ts";
import type { EnvVars } from "../../infra/config.env.ts";
import { now } from "../../utils/now.ts";
import { ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import { SyncTokenStore } from "./sync-token-store.ts";

const SYNC_OVERLAP_WINDOW_IN_MS = 60 * 60 * 1000;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  cache: Redis;
  env: EnvVars;
  user: CurrentUser;
  merchantFinder: MerchantFinder;
  productFinder: ProductFinder;
  collectionFinder: CollectionFinder;
  customerFinder: CustomerFinder;
  supplierFinder: SupplierFinder;
  locationFinder: LocationFinder;
};

class IncrementalSyncService extends BaseService<SyncRequest, SyncResponse> {
  private readonly tokens: SyncTokenStore;

  constructor(private readonly dependencies: InjectedDependencies) {
    super(dependencies.logger);
    this.tokens = new SyncTokenStore(dependencies.cache, dependencies.env.CLERK_SECRET_KEY);
  }

  static create(dependencies: InjectedDependencies): IncrementalSyncService {
    return new IncrementalSyncService(dependencies);
  }

  async execute(request: SyncRequest): Promise<Result<SyncResponse, BusinessError>> {
    const {
      db,
      user,
      merchantFinder,
      productFinder,
      collectionFinder,
      customerFinder,
      supplierFinder,
      locationFinder,
    } = this.dependencies;
    const previous = await this.tokens.load(request.syncToken, user.merchantId);
    if (!previous.success) {
      return previous;
    }

    const currentSyncedAt = now();
    const criteria = {
      merchantId: user.merchantId,
      previousSyncedAt: previous.value ? new Date(previous.value.getTime() - SYNC_OVERLAP_WINDOW_IN_MS) : null,
      currentSyncedAt,
    };
    const resources = await db.transaction(
      async (trx) => {
        const [merchant, products, collections, customers, suppliers, locations] = await Promise.all([
          merchantFinder.findForSync(trx, criteria),
          productFinder.findForSync(trx, criteria),
          collectionFinder.findForSync(trx, criteria),
          customerFinder.findForSync(trx, criteria),
          supplierFinder.findForSync(trx, criteria),
          locationFinder.findForSync(trx, criteria),
        ]);

        return { merchant, products, collections, customers, suppliers, locations };
      },
      { isolationLevel: "repeatable read", withConsistentSnapshot: true },
    );

    const token = await this.tokens.save(currentSyncedAt, user.merchantId);
    if (!token.success) {
      return token;
    }

    return ok({
      ...resources,
      fullSync: previous.value === null,
      syncToken: token.value,
    });
  }
}

export { IncrementalSyncService };
