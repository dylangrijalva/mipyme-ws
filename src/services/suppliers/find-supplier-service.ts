import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Supplier } from "../../contracts/supplier.ts";
import type { Database } from "../../db/index.ts";
import type { SupplierFinder } from "../../finders/supplier-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  supplierFinder: SupplierFinder;
  user: CurrentUser;
};

class FindSupplierService extends BaseService<string, Supplier> {
  private readonly db: Database;
  private readonly supplierFinder: SupplierFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, supplierFinder: SupplierFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.supplierFinder = supplierFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): FindSupplierService {
    return new FindSupplierService(deps.logger, deps.db, deps.supplierFinder, deps.user);
  }

  async execute(id: string): Promise<Result<Supplier, BusinessError>> {
    const supplier = await this.supplierFinder.find(this.db, { id, merchantId: this.user.merchantId });

    if (!supplier) {
      return err({ code: codes.resourceNotFound, message: `Supplier ${id} has not been found.`, details: [] });
    }

    return ok(supplier);
  }
}

export { FindSupplierService };
