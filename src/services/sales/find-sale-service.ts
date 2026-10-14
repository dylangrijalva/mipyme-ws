import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Sale } from "../../contracts/sale.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { SaleFinder } from "../../finders/sale-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { splitDistinct } from "../../utils/split-distinct.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  saleFinder: SaleFinder;
  user: CurrentUser;
};

class FindSaleService extends BaseService<string, Sale> {
  private readonly db: Database;
  private readonly saleFinder: SaleFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, saleFinder: SaleFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.saleFinder = saleFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): FindSaleService {
    return new FindSaleService(deps.logger, deps.db, deps.saleFinder, deps.user);
  }

  async execute(id: string): Promise<Result<Sale, BusinessError>> {
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
        message: "You do not have permission to view sales.",
        details: [],
      });
    }

    const sale = await this.saleFinder.find(this.db, {
      id,
      merchantId: this.user.merchantId,
      employeeId: employee.isOwner ? undefined : employee.id,
    });

    if (!sale) {
      return err({
        code: codes.resourceNotFound,
        message: `Sale ${id} has not been found.`,
        details: [],
      });
    }

    return ok(sale);
  }
}

export { FindSaleService };
