import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Customer } from "../../contracts/customer.ts";
import type { Database } from "../../db/index.ts";
import type { CustomerFinder } from "../../finders/customer-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  customerFinder: CustomerFinder;
  user: CurrentUser;
};

class FindCustomerService extends BaseService<string, Customer> {
  private readonly db: Database;
  private readonly customerFinder: CustomerFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, customerFinder: CustomerFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.customerFinder = customerFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): FindCustomerService {
    return new FindCustomerService(deps.logger, deps.db, deps.customerFinder, deps.user);
  }

  async execute(request: string): Promise<Result<Customer, BusinessError>> {
    const customer = await this.customerFinder.find(this.db, { id: request, merchantId: this.user.merchantId });

    if (!customer) {
      return err({
        code: codes.resourceNotFound,
        message: `Customer ${request} has not been found.`,
        details: [],
      });
    }

    return ok(customer);
  }
}

export { FindCustomerService };
