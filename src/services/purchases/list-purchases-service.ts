import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { PaginationResponse } from "../../contracts/pagination-response.ts";
import type { PurchasePaginationRequest } from "../../contracts/purchase-pagination-query.ts";
import type { Purchase } from "../../contracts/purchase.ts";
import type { Database } from "../../db/index.ts";
import type { PurchaseFinder } from "../../finders/purchase-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import type { EmployeeAuthorizationService } from "../employee-authorization-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  employeeAuthorizationService: EmployeeAuthorizationService;
  purchaseFinder: PurchaseFinder;
  user: CurrentUser;
};

class ListPurchasesService extends BaseService<PurchasePaginationRequest, PaginationResponse<Purchase>> {
  private readonly db: Database;
  private readonly employeeAuthorizationService: EmployeeAuthorizationService;
  private readonly purchaseFinder: PurchaseFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    employeeAuthorizationService: EmployeeAuthorizationService,
    purchaseFinder: PurchaseFinder,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.employeeAuthorizationService = employeeAuthorizationService;
    this.purchaseFinder = purchaseFinder;
    this.user = user;
  }

  static create({
    logger,
    db,
    employeeAuthorizationService,
    purchaseFinder,
    user,
  }: InjectedDependencies): ListPurchasesService {
    return new ListPurchasesService(logger, db, employeeAuthorizationService, purchaseFinder, user);
  }

  async execute(request: PurchasePaginationRequest): Promise<Result<PaginationResponse<Purchase>, BusinessError>> {
    const authorization = await this.employeeAuthorizationService.authorizePermission({
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

    const page = await this.purchaseFinder.paginate(this.db, {
      ...request,
      merchantId: this.user.merchantId,
      employeeId: employee.isOwner ? undefined : employee.id,
    });

    return ok(page);
  }
}

export { ListPurchasesService };
