import type { Logger } from "pino";
import type { BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { SyncRequest, SyncResponse } from "../../contracts/sync.ts";
import type { Database } from "../../db/index.ts";
import type { CollectionFinder } from "../../finders/collection-finder.ts";
import type { CustomerFinder } from "../../finders/customer-finder.ts";
import type { EmployeeFinder } from "../../finders/employee-finder.ts";
import type { LocationFinder } from "../../finders/location-finder.ts";
import type { MerchantFinder } from "../../finders/merchant-finder.ts";
import type { ProductFinder } from "../../finders/product-finder.ts";
import type { SupplierFinder } from "../../finders/supplier-finder.ts";
import { now } from "../../utils/now.ts";
import { ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import type { SyncTokenStore } from "./sync-token-store.ts";

const SYNC_OVERLAP_WINDOW_IN_MS = 60 * 60 * 1000;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  syncTokenStore: SyncTokenStore;
  user: CurrentUser;
  merchantFinder: MerchantFinder;
  productFinder: ProductFinder;
  collectionFinder: CollectionFinder;
  customerFinder: CustomerFinder;
  supplierFinder: SupplierFinder;
  locationFinder: LocationFinder;
  employeeFinder: EmployeeFinder;
};

class IncrementalSyncService extends BaseService<SyncRequest, SyncResponse> {
  private readonly syncTokenStore: SyncTokenStore;
  private readonly db: Database;
  private readonly user: CurrentUser;
  private readonly merchantFinder: MerchantFinder;
  private readonly productFinder: ProductFinder;
  private readonly collectionFinder: CollectionFinder;
  private readonly customerFinder: CustomerFinder;
  private readonly supplierFinder: SupplierFinder;
  private readonly locationFinder: LocationFinder;
  private readonly employeeFinder: EmployeeFinder;

  constructor(
    logger: Logger,
    db: Database,
    syncTokenStore: SyncTokenStore,
    user: CurrentUser,
    merchantFinder: MerchantFinder,
    productFinder: ProductFinder,
    collectionFinder: CollectionFinder,
    customerFinder: CustomerFinder,
    supplierFinder: SupplierFinder,
    locationFinder: LocationFinder,
    employeeFinder: EmployeeFinder,
  ) {
    super(logger);
    this.syncTokenStore = syncTokenStore;
    this.db = db;
    this.user = user;
    this.merchantFinder = merchantFinder;
    this.productFinder = productFinder;
    this.collectionFinder = collectionFinder;
    this.customerFinder = customerFinder;
    this.supplierFinder = supplierFinder;
    this.locationFinder = locationFinder;
    this.employeeFinder = employeeFinder;
  }

  static create({
    logger,
    db,
    syncTokenStore,
    user,
    merchantFinder,
    productFinder,
    collectionFinder,
    customerFinder,
    supplierFinder,
    locationFinder,
    employeeFinder,
  }: InjectedDependencies): IncrementalSyncService {
    return new IncrementalSyncService(
      logger,
      db,
      syncTokenStore,
      user,
      merchantFinder,
      productFinder,
      collectionFinder,
      customerFinder,
      supplierFinder,
      locationFinder,
      employeeFinder,
    );
  }

  async execute(request: SyncRequest): Promise<Result<SyncResponse, BusinessError>> {
    const previous = await this.syncTokenStore.load(request.syncToken, this.user.merchantId);
    if (!previous.success) {
      return previous;
    }

    const currentSyncedAt = now();
    const criteria = {
      merchantId: this.user.merchantId,
      previousSyncedAt: previous.value ? new Date(previous.value.getTime() - SYNC_OVERLAP_WINDOW_IN_MS) : null,
      currentSyncedAt,
    };
    const resources = await this.db.transaction(
      async (trx) => {
        const [merchant, products, collections, customers, suppliers, locations, employees] = await Promise.all([
          this.merchantFinder.findForSync(trx, criteria),
          this.productFinder.findForSync(trx, criteria),
          this.collectionFinder.findForSync(trx, criteria),
          this.customerFinder.findForSync(trx, criteria),
          this.supplierFinder.findForSync(trx, criteria),
          this.locationFinder.findForSync(trx, criteria),
          this.employeeFinder.findForSync(trx, criteria),
        ]);

        return { merchant, products, collections, customers, suppliers, locations, employees };
      },
      { isolationLevel: "repeatable read", withConsistentSnapshot: true },
    );

    const token = await this.syncTokenStore.save(currentSyncedAt, this.user.merchantId);
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
