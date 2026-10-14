import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { PaginationResponse } from "../../contracts/pagination-response.ts";
import type { SalePaginationRequest } from "../../contracts/sale-pagination-query.ts";
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

class ListSalesService extends BaseService<SalePaginationRequest, PaginationResponse<Sale>> {
  private readonly db: Database;
  private readonly saleFinder: SaleFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, saleFinder: SaleFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.saleFinder = saleFinder;
    this.user = user;
  }

  static create(deps: InjectedDependencies): ListSalesService {
    return new ListSalesService(deps.logger, deps.db, deps.saleFinder, deps.user);
  }

  async execute(request: SalePaginationRequest): Promise<Result<PaginationResponse<Sale>, BusinessError>> {
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

    const page = await this.saleFinder.paginate(this.db, {
      ...request,
      merchantId: this.user.merchantId,
      employeeId: employee.isOwner ? undefined : employee.id,
    });

    return ok(page);
  }
}

export { ListSalesService };
