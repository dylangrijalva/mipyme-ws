import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Purchase } from "../../contracts/purchase.ts";
import type { Database } from "../../db/index.ts";
import type { PurchaseFinder } from "../../finders/purchase-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import { EmployeeAuthorizationService } from "../employee-authorization-service.ts";

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
    const employeeAuthorization = EmployeeAuthorizationService.create({ db: this.db });
    const authorization = await employeeAuthorization.authorizePermission({
      employeeId: this.user.employeeId,
      merchantId: this.user.merchantId,
      permission: "view_transactions",
    });
    if (!authorization.success) {
      return err({
        code: codes.forbiddenError,
        message: "You do not have permission to view purchases.",
        details: [],
      });
    }
    const employee = authorization.value;

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
