import { and, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { InventoryChangePaginationRequest } from "../../contracts/inventory-change-pagination-query.ts";
import type { InventoryChange } from "../../contracts/inventory-change.ts";
import type { PaginationResponse } from "../../contracts/pagination-response.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { InventoryChangeFinder } from "../../finders/inventory-change-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import type { EmployeeAuthorizationService } from "../employee-authorization-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  employeeAuthorizationService: EmployeeAuthorizationService;
  inventoryChangeFinder: InventoryChangeFinder;
  user: CurrentUser;
};

class ListInventoryChangesService extends BaseService<
  InventoryChangePaginationRequest,
  PaginationResponse<InventoryChange>
> {
  private readonly db: Database;
  private readonly employeeAuthorizationService: EmployeeAuthorizationService;
  private readonly inventoryChangeFinder: InventoryChangeFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    employeeAuthorizationService: EmployeeAuthorizationService,
    inventoryChangeFinder: InventoryChangeFinder,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.employeeAuthorizationService = employeeAuthorizationService;
    this.inventoryChangeFinder = inventoryChangeFinder;
    this.user = user;
  }

  static create({
    logger,
    db,
    employeeAuthorizationService,
    inventoryChangeFinder,
    user,
  }: InjectedDependencies): ListInventoryChangesService {
    return new ListInventoryChangesService(logger, db, employeeAuthorizationService, inventoryChangeFinder, user);
  }

  async execute(
    request: InventoryChangePaginationRequest,
  ): Promise<Result<PaginationResponse<InventoryChange>, BusinessError>> {
    const authorization = await this.employeeAuthorizationService.authorizePermission({
      employeeId: this.user.employeeId,
      merchantId: this.user.merchantId,
      permission: "view_inventory_reports",
    });
    if (!authorization.success) {
      return err({
        code: codes.forbiddenError,
        message: "You do not have permission to view inventory history.",
        details: [],
      });
    }

    const employee = authorization.value;
    // A silently narrowed history would understate losses, so asking for a location outside the employee's
    // access is rejected instead of filtered out.
    if (!employee.isOwner && request.locationIds !== undefined) {
      const accessibleLocations = await this.db
        .select({ locationId: tables.locationAccess.locationId })
        .from(tables.locationAccess)
        .where(
          and(
            eq(tables.locationAccess.merchantId, this.user.merchantId),
            eq(tables.locationAccess.employeeId, employee.id),
            inArray(tables.locationAccess.locationId, request.locationIds),
          ),
        );

      if (accessibleLocations.length !== request.locationIds.length) {
        return err({
          code: codes.forbiddenError,
          message: "You do not have access to one or more of the requested locations.",
          details: [],
        });
      }
    }

    const page = await this.inventoryChangeFinder.paginate(this.db, {
      ...request,
      merchantId: this.user.merchantId,
      employeeId: employee.isOwner ? undefined : employee.id,
    });

    return ok(page);
  }
}

export { ListInventoryChangesService };
