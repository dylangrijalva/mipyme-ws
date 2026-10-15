import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Supplier } from "../../contracts/supplier.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { SupplierFinder } from "../../finders/supplier-finder.ts";
import type { RealtimeEventPublisher } from "../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { hasDefinedValues } from "../../utils/has-defined-values.ts";
import { now } from "../../utils/now.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  supplierFinder: SupplierFinder;
  user: CurrentUser;
};

const UpdateSupplierRequest = z.object({
  name: z.string().trim().nonempty().max(128).optional(),
  email: z.string().trim().nonempty().max(320).nullish(),
  phone: z.string().trim().nonempty().max(32).nullish(),
});

type UpdateSupplierRequest = z.infer<typeof UpdateSupplierRequest>;

class UpdateSupplierService extends BaseService<[string, UpdateSupplierRequest], Supplier> {
  private readonly db: Database;
  private readonly publisher: RealtimeEventPublisher;
  private readonly supplierFinder: SupplierFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    supplierFinder: SupplierFinder,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.publisher = publisher;
    this.supplierFinder = supplierFinder;
    this.user = user;
  }

  static create({ logger, db, supplierFinder, publisher, user }: InjectedDependencies): UpdateSupplierService {
    return new UpdateSupplierService(logger, db, supplierFinder, publisher, user);
  }

  async execute(request: [string, UpdateSupplierRequest]): Promise<Result<Supplier, BusinessError>> {
    const result = await this.updateSupplier(request);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "supplier", snapshot: result.value },
      });
    }

    return result;
  }

  private async updateSupplier(request: [string, UpdateSupplierRequest]): Promise<Result<Supplier, BusinessError>> {
    const [id, changes] = request;

    const supplier = await this.supplierFinder.find(this.db, { id, merchantId: this.user.merchantId });
    if (!supplier) {
      return err({
        code: codes.resourceNotFound,
        message: `Supplier ${id} has not been found.`,
        details: [],
      });
    }

    if (!hasDefinedValues(changes)) {
      return ok(supplier);
    }

    await this.db
      .update(tables.supplier)
      .set({ ...changes, updatedAt: now() })
      .where(and(eq(tables.supplier.id, id), eq(tables.supplier.merchantId, this.user.merchantId)));

    return ok(await assertFound(this.supplierFinder.find(this.db, { id, merchantId: this.user.merchantId })));
  }
}

export { UpdateSupplierRequest, UpdateSupplierService };
