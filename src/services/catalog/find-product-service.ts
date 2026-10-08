import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Product } from "../../contracts/product.ts";
import type { Database } from "../../db/index.ts";
import type { ProductFinder } from "../../finders/product-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  productFinder: ProductFinder;
  user: CurrentUser;
};

class FindProductService extends BaseService<string, Product> {
  private readonly db: Database;
  private readonly productFinder: ProductFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, productFinder: ProductFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.productFinder = productFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): FindProductService {
    return new FindProductService(deps.logger, deps.db, deps.productFinder, deps.user);
  }

  async execute(id: string): Promise<Result<Product, BusinessError>> {
    const product = await this.productFinder.find(this.db, { id, merchantId: this.user.id });
    if (!product) {
      return err({
        code: codes.resourceNotFound,
        message: `Product ${id} has not been found.`,
        details: [],
      });
    }

    return ok(product);
  }
}

export { FindProductService };
