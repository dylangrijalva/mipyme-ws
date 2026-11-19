import Big from "big.js";
import { and, eq, inArray } from "drizzle-orm";
import z from "zod";
import { codes, type BusinessError } from "../contracts/business-error.ts";
import type { CurrentUser } from "../contracts/current-user.ts";
import { Decimal } from "../contracts/decimal.ts";
import { PERMISSIONS_DELIMITER } from "../contracts/employee.ts";
import type { EmployeeStatus } from "../contracts/employee-status.ts";
import { ObjectId } from "../contracts/object-id.ts";
import { PosPermission } from "../contracts/pos-permission.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { generateId } from "../utils/generate-id.ts";
import { err, ok, type Result } from "../utils/result.ts";
import type { AuthorizedEmployee, EmployeeAuthorizationService } from "./employee-authorization-service.ts";

const EmployeePermissions = z.array(PosPermission).transform((permissions) => [...new Set(permissions)]);

const MaxDiscountRate = Decimal.pipe(
  z.string().refine((value) => new Big(value).lte(1), "The maximum discount rate must be between 0.00 and 1.00."),
);

const EmployeeLocationIds = z.array(ObjectId).transform((locationIds) => [...new Set(locationIds)]);

const PIN_HOLDING_STATUSES: Array<EmployeeStatus> = ["enabled", "disabled"];

const PIN_ALREADY_EXISTS: BusinessError = Object.freeze({
  code: codes.pinAlreadyExists,
  message: "The PIN is already used by another employee of your business. Choose a different PIN.",
  details: [],
});

type ResolveCreditedEmployeeRequest = {
  merchantId: string;
  requestedEmployeeId: string | null | undefined;
  defaultEmployeeId: string;
};

type ReplaceLocationAccessRequest = {
  merchantId: string;
  employeeId: string;
  locationIds: Array<string>;
};

class EmployeeManagement {
  private readonly employeeAuthorizationService: EmployeeAuthorizationService;

  constructor(employeeAuthorizationService: EmployeeAuthorizationService) {
    this.employeeAuthorizationService = employeeAuthorizationService;
  }

  async authorize(user: CurrentUser): Promise<Result<AuthorizedEmployee, BusinessError>> {
    const authorization = await this.employeeAuthorizationService.authorizePermission({
      employeeId: user.employeeId,
      merchantId: user.merchantId,
      permission: "manage_employees",
    });

    if (!authorization.success) {
      return err({
        code: codes.forbiddenError,
        message: "You do not have permission to manage employees.",
        details: [],
      });
    }

    return ok(authorization.value);
  }

  async resolveCreditedEmployeeId(
    db: Database,
    request: ResolveCreditedEmployeeRequest,
  ): Promise<Result<string, BusinessError>> {
    if (request.requestedEmployeeId === null || request.requestedEmployeeId === undefined) {
      return ok(request.defaultEmployeeId);
    }

    const [employee] = await db
      .select({ id: tables.employee.id, status: tables.employee.status })
      .from(tables.employee)
      .where(
        and(eq(tables.employee.id, request.requestedEmployeeId), eq(tables.employee.merchantId, request.merchantId)),
      )
      .limit(1);

    if (!employee) {
      return err({ code: codes.resourceNotFound, message: "The employee has not been found.", details: [] });
    }

    if (employee.status !== "enabled") {
      return err({ code: codes.forbiddenError, message: "The employee is not enabled.", details: [] });
    }

    return ok(employee.id);
  }

  async lockMerchant(db: Database, merchantId: string): Promise<void> {
    await db
      .select({ id: tables.merchant.id })
      .from(tables.merchant)
      .where(eq(tables.merchant.id, merchantId))
      .for("update");
  }

  async assertLocationsExist(
    db: Database,
    merchantId: string,
    locationIds: Array<string>,
  ): Promise<Result<void, BusinessError>> {
    if (locationIds.length === 0) {
      return ok(undefined);
    }

    const locations = await db
      .select({ id: tables.location.id })
      .from(tables.location)
      .where(and(eq(tables.location.merchantId, merchantId), inArray(tables.location.id, locationIds)));

    if (locations.length !== locationIds.length) {
      return err({ code: codes.resourceNotFound, message: "One or more locations have not been found.", details: [] });
    }

    return ok(undefined);
  }

  async replaceLocationAccess(db: Database, request: ReplaceLocationAccessRequest): Promise<void> {
    await db
      .delete(tables.locationAccess)
      .where(
        and(
          eq(tables.locationAccess.merchantId, request.merchantId),
          eq(tables.locationAccess.employeeId, request.employeeId),
        ),
      );

    if (request.locationIds.length === 0) {
      return;
    }

    await db.insert(tables.locationAccess).values(
      request.locationIds.map((locationId) => ({
        id: generateId({ model: "locationAccess" }),
        locationId,
        employeeId: request.employeeId,
        merchantId: request.merchantId,
      })),
    );
  }

  serializePermissions(permissions: Array<PosPermission>): string | null {
    return permissions.length === 0 ? null : permissions.join(PERMISSIONS_DELIMITER);
  }
}

export {
  EmployeeLocationIds,
  EmployeeManagement,
  EmployeePermissions,
  MaxDiscountRate,
  PIN_ALREADY_EXISTS,
  PIN_HOLDING_STATUSES,
};
