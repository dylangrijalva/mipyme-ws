import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Sale } from "../../contracts/sale.ts";
import type { Database } from "../../db/index.ts";
import type { SaleFinder } from "../../finders/sale-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import { EmployeeAuthorizationService } from "../employee-authorization-service.ts";

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

  static create({ logger, db, saleFinder, user }: InjectedDependencies): FindSaleService {
    return new FindSaleService(logger, db, saleFinder, user);
  }

  async execute(id: string): Promise<Result<Sale, BusinessError>> {
    const employeeAuthorization = EmployeeAuthorizationService.create({ db: this.db });
    const authorization = await employeeAuthorization.authorizePermission({
      employeeId: this.user.employeeId,
      merchantId: this.user.merchantId,
      permission: "view_transactions",
    });
    if (!authorization.success) {
      return err({
        code: codes.forbiddenError,
        message: "You do not have permission to view sales.",
        details: [],
      });
    }
    const employee = authorization.value;

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
