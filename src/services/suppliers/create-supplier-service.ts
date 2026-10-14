import type { Logger } from "pino";
import z from "zod";
import type { BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Supplier } from "../../contracts/supplier.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { SupplierFinder } from "../../finders/supplier-finder.ts";
import type { RealtimeEventPublisher } from "../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { generateId } from "../../utils/generate-id.ts";
import { ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  publisher: Pick<RealtimeEventPublisher, "broadcast">;
  logger: Logger;
  db: Database;
  supplierFinder: SupplierFinder;
  user: CurrentUser;
};

const CreateSupplierRequest = z.object({
  name: z.string().trim().nonempty().max(128),
  email: z.string().trim().nonempty().max(320).nullish(),
  phone: z.string().trim().nonempty().max(32).nullish(),
});

type CreateSupplierRequest = z.infer<typeof CreateSupplierRequest>;

class CreateSupplierService extends BaseService<CreateSupplierRequest, Supplier> {
  private readonly publisher: Pick<RealtimeEventPublisher, "broadcast">;
  private readonly db: Database;
  private readonly supplierFinder: SupplierFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    supplierFinder: SupplierFinder,
    user: CurrentUser,
    publisher: Pick<RealtimeEventPublisher, "broadcast">,
  ) {
    super(logger);
    this.publisher = publisher;
    this.db = db;
    this.supplierFinder = supplierFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): CreateSupplierService {
    return new CreateSupplierService(deps.logger, deps.db, deps.supplierFinder, deps.user, deps.publisher);
  }

  async execute(request: CreateSupplierRequest): Promise<Result<Supplier, BusinessError>> {
    const result = await this.createSupplier(request);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "supplier", snapshot: result.value },
      });
    }

    return result;
  }

  private async createSupplier(request: CreateSupplierRequest): Promise<Result<Supplier, BusinessError>> {
    const id = generateId({ model: "supplier" });

    await this.db.insert(tables.supplier).values({
      id,
      merchantId: this.user.merchantId,
      name: request.name,
      email: request.email ?? null,
      phone: request.phone ?? null,
    });

    return ok(await assertFound(this.supplierFinder.find(this.db, { id, merchantId: this.user.merchantId })));
  }
}

export { CreateSupplierRequest, CreateSupplierService };
