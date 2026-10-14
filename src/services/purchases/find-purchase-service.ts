import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Purchase } from "../../contracts/purchase.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { PurchaseFinder } from "../../finders/purchase-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { splitDistinct } from "../../utils/split-distinct.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  purchaseFinder: PurchaseFinder;
  user: CurrentUser;
};

class FindPurchaseService extends BaseService<string, Purchase> {
  private readonly db: Database;
  private readonly purchaseFinder: PurchaseFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, purchaseFinder: PurchaseFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.purchaseFinder = purchaseFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): FindPurchaseService {
    return new FindPurchaseService(deps.logger, deps.db, deps.purchaseFinder, deps.user);
  }

  async execute(id: string): Promise<Result<Purchase, BusinessError>> {
    const [employee] = await this.db
      .select()
      .from(tables.employee)
      .where(and(eq(tables.employee.id, this.user.employeeId), eq(tables.employee.merchantId, this.user.merchantId)))
      .limit(1);
    if (
      !employee ||
      employee.status !== "enabled" ||
      (!employee.isOwner && !splitDistinct(employee.permissions, " ").includes("view_transactions"))
    ) {
      return err({
        code: codes.forbiddenError,
        message: "You do not have permission to view purchases.",
        details: [],
      });
    }

    const purchase = await this.purchaseFinder.find(this.db, {
      id,
      merchantId: this.user.merchantId,
      employeeId: employee.isOwner ? undefined : employee.id,
    });

    if (!purchase) {
      return err({
        code: codes.resourceNotFound,
        message: `Purchase ${id} has not been found.`,
        details: [],
      });
    }

    return ok(purchase);
  }
}

export { FindPurchaseService };
