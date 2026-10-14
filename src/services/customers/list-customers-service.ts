import type { Logger } from "pino";
import type { BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Customer } from "../../contracts/customer.ts";
import type { PaginationRequest } from "../../contracts/pagination-query.ts";
import type { PaginationResponse } from "../../contracts/pagination-response.ts";
import type { Database } from "../../db/index.ts";
import type { CustomerFinder } from "../../finders/customer-finder.ts";
import { ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  customerFinder: CustomerFinder;
  user: CurrentUser;
};

class ListCustomersService extends BaseService<PaginationRequest, PaginationResponse<Customer>> {
  private readonly db: Database;
  private readonly customerFinder: CustomerFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, customerFinder: CustomerFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.customerFinder = customerFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): ListCustomersService {
    return new ListCustomersService(deps.logger, deps.db, deps.customerFinder, deps.user);
  }

  async execute(request: PaginationRequest): Promise<Result<PaginationResponse<Customer>, BusinessError>> {
    const response = await this.customerFinder.paginate(this.db, {
      ...request,
      merchantId: this.user.merchantId,
    });

    return ok(response);
  }
}

export { ListCustomersService };
