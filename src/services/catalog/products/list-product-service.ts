import type { Logger } from "pino";
import type { BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { PaginationRequest } from "../../../contracts/pagination-query.ts";
import type { PaginationResponse } from "../../../contracts/pagination-response.ts";
import type { Product } from "../../../contracts/product.ts";
import type { Database } from "../../../db/index.ts";
import type { ProductFinder } from "../../../finders/product-finder.ts";
import { ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  productFinder: ProductFinder;
  user: CurrentUser;
};

class ListProductsService extends BaseService<PaginationRequest, PaginationResponse<Product>> {
  private readonly db: Database;
  private readonly productFinder: ProductFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, productFinder: ProductFinder, currentUser: CurrentUser) {
    super(logger);
    this.db = db;
    this.productFinder = productFinder;
    this.user = currentUser;
  }

  static create(deps: InjectedDependencies): ListProductsService {
    return new ListProductsService(deps.logger, deps.db, deps.productFinder, deps.user);
  }

  async execute(request: PaginationRequest): Promise<Result<PaginationResponse<Product>, BusinessError>> {
    const response = await this.productFinder.paginate(this.db, {
      ...request,
      merchantId: this.user.merchantId,
    });

    return ok(response);
  }
}

export { ListProductsService };
