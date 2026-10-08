import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Customer } from "../../contracts/customer.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { CustomerFinder } from "../../finders/customer-finder.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { hasDefinedValues } from "../../utils/has-defined-values.ts";
import { now } from "../../utils/now.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

const UpdateCustomerRequest = z.object({
  name: z.string().trim().nonempty().max(128).optional(),
  email: z.string().trim().nonempty().max(320).nullish(),
  phone: z.string().trim().nonempty().max(32).nullish(),
});

type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  customerFinder: CustomerFinder;
  user: CurrentUser;
};

class UpdateCustomerService extends BaseService<[string, UpdateCustomerRequest], Customer> {
  private readonly db: Database;
  private readonly customerFinder: CustomerFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, customerFinder: CustomerFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.customerFinder = customerFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): UpdateCustomerService {
    return new UpdateCustomerService(deps.logger, deps.db, deps.customerFinder, deps.user);
  }

  async execute(request: [string, UpdateCustomerRequest]): Promise<Result<Customer, BusinessError>> {
    const [id, values] = request;

    const customer = await this.customerFinder.find(this.db, { id, merchantId: this.user.merchantId });
    if (!customer) {
      return err({
        code: codes.resourceNotFound,
        message: `Customer ${id} has not been found.`,
        details: [],
      });
    }

    if (!hasDefinedValues(values)) {
      return ok(customer);
    }

    await this.db
      .update(tables.customer)
      .set({ ...values, updatedAt: now() })
      .where(and(eq(tables.customer.id, id), eq(tables.customer.merchantId, this.user.merchantId)));

    const updatedCustomer = await assertFound(
      this.customerFinder.find(this.db, { id, merchantId: this.user.merchantId }),
    );

    return ok(updatedCustomer);
  }
}

export { UpdateCustomerService, UpdateCustomerRequest };
