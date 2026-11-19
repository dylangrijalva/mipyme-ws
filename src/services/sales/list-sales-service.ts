import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { PaginationResponse } from "../../contracts/pagination-response.ts";
import type { SalePaginationRequest } from "../../contracts/sale-pagination-query.ts";
import type { Sale } from "../../contracts/sale.ts";
import type { Database } from "../../db/index.ts";
import type { SaleFinder } from "../../finders/sale-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import type { EmployeeAuthorizationService } from "../employee-authorization-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  employeeAuthorizationService: EmployeeAuthorizationService;
  saleFinder: SaleFinder;
  user: CurrentUser;
};

class ListSalesService extends BaseService<SalePaginationRequest, PaginationResponse<Sale>> {
  private readonly db: Database;
  private readonly employeeAuthorizationService: EmployeeAuthorizationService;
  private readonly saleFinder: SaleFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    employeeAuthorizationService: EmployeeAuthorizationService,
    saleFinder: SaleFinder,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.employeeAuthorizationService = employeeAuthorizationService;
    this.saleFinder = saleFinder;
    this.user = user;
  }

  static create({
    logger,
    db,
    employeeAuthorizationService,
    saleFinder,
    user,
  }: InjectedDependencies): ListSalesService {
    return new ListSalesService(logger, db, employeeAuthorizationService, saleFinder, user);
  }

  async execute(request: SalePaginationRequest): Promise<Result<PaginationResponse<Sale>, BusinessError>> {
    const authorization = await this.employeeAuthorizationService.authorizePermission({
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

    const page = await this.saleFinder.paginate(this.db, {
      ...request,
      merchantId: this.user.merchantId,
      employeeId: employee.isOwner ? undefined : employee.id,
    });

    return ok(page);
  }
}

export { ListSalesService };
