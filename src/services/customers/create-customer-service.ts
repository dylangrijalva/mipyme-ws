import type { Logger } from "pino";
import z from "zod";
import type { BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Customer } from "../../contracts/customer.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { CustomerFinder } from "../../finders/customer-finder.ts";
import type { RealtimeEventPublisher } from "../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { generateId } from "../../utils/generate-id.ts";
import { ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

const CreateCustomerRequest = z.object({
  name: z.string().trim().nonempty().max(128),
  email: z.string().trim().nonempty().max(320).nullish(),
  phone: z.string().trim().nonempty().max(32).nullish(),
});

type CreateCustomerRequest = z.infer<typeof CreateCustomerRequest>;

type InjectedDependencies = {
  publisher: Pick<RealtimeEventPublisher, "broadcast">;
  logger: Logger;
  db: Database;
  customerFinder: CustomerFinder;
  user: CurrentUser;
};

class CreateCustomerService extends BaseService<CreateCustomerRequest, Customer> {
  private readonly publisher: Pick<RealtimeEventPublisher, "broadcast">;
  private readonly db: Database;
  private readonly customerFinder: CustomerFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    customerFinder: CustomerFinder,
    user: CurrentUser,
    publisher: Pick<RealtimeEventPublisher, "broadcast">,
  ) {
    super(logger);
    this.publisher = publisher;
    this.db = db;
    this.customerFinder = customerFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): CreateCustomerService {
    return new CreateCustomerService(deps.logger, deps.db, deps.customerFinder, deps.user, deps.publisher);
  }

  async execute(request: CreateCustomerRequest): Promise<Result<Customer, BusinessError>> {
    const result = await this.createCustomer(request);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "customer", snapshot: result.value },
      });
    }

    return result;
  }

  private async createCustomer(request: CreateCustomerRequest): Promise<Result<Customer, BusinessError>> {
    const id = generateId({ model: "customer" });

    await this.db.insert(tables.customer).values({
      id,
      merchantId: this.user.merchantId,
      name: request.name,
      email: request.email ?? null,
      phone: request.phone ?? null,
    });

    const customer = await assertFound(this.customerFinder.find(this.db, { id, merchantId: this.user.merchantId }));
    return ok(customer);
  }
}

export { CreateCustomerRequest, CreateCustomerService };
