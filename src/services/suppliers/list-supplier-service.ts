import type { Logger } from "pino";
import type { BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { PaginationRequest } from "../../contracts/pagination-query.ts";
import type { PaginationResponse } from "../../contracts/pagination-response.ts";
import type { Supplier } from "../../contracts/supplier.ts";
import type { Database } from "../../db/index.ts";
import type { SupplierFinder } from "../../finders/supplier-finder.ts";
import { ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  supplierFinder: SupplierFinder;
  user: CurrentUser;
};

class ListSuppliersService extends BaseService<PaginationRequest, PaginationResponse<Supplier>> {
  private readonly db: Database;
  private readonly supplierFinder: SupplierFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, supplierFinder: SupplierFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.supplierFinder = supplierFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): ListSuppliersService {
    return new ListSuppliersService(deps.logger, deps.db, deps.supplierFinder, deps.user);
  }

  async execute(request: PaginationRequest): Promise<Result<PaginationResponse<Supplier>, BusinessError>> {
    return ok(await this.supplierFinder.paginate(this.db, { ...request, merchantId: this.user.merchantId }));
  }
}

export { ListSuppliersService };
