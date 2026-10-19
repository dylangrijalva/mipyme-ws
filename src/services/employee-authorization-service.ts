import { and, eq } from "drizzle-orm";
import type { PosPermission } from "../contracts/pos-permission.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { ok, type Failure, type Result } from "../utils/result.ts";
import { splitDistinct } from "../utils/split-distinct.ts";

type AuthorizedEmployee = typeof tables.employee.$inferSelect;

type EmployeeAuthorizationFailure =
  | { kind: "employee_unavailable" }
  | { kind: "permission_denied"; permission: PosPermission }
  | { kind: "location_not_found"; locationId: string }
  | { kind: "location_access_denied"; locationId: string };

type AuthorizePermissionRequest = {
  employeeId: string;
  merchantId: string;
  permission: PosPermission;
};

type AuthorizeLocationAccessRequest = {
  employee: AuthorizedEmployee;
  locationId: string;
};

type InjectedDependencies = {
  db: Database;
};

function failure(error: EmployeeAuthorizationFailure): Failure<EmployeeAuthorizationFailure> {
  return { success: false, error };
}

class EmployeeAuthorizationService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  static create({ db }: InjectedDependencies): EmployeeAuthorizationService {
    return new EmployeeAuthorizationService(db);
  }

  async authorizePermission(
    request: AuthorizePermissionRequest,
  ): Promise<Result<AuthorizedEmployee, EmployeeAuthorizationFailure>> {
    const [employee] = await this.db
      .select()
      .from(tables.employee)
      .where(and(eq(tables.employee.id, request.employeeId), eq(tables.employee.merchantId, request.merchantId)))
      .limit(1);

    if (!employee || employee.status !== "enabled") {
      return failure({ kind: "employee_unavailable" });
    }

    const permissions = splitDistinct(employee.permissions, " ");
    if (!employee.isOwner && !permissions.includes(request.permission)) {
      return failure({ kind: "permission_denied", permission: request.permission });
    }

    return ok(employee);
  }

  async authorizeLocationAccess(
    request: AuthorizeLocationAccessRequest,
  ): Promise<Result<void, EmployeeAuthorizationFailure>> {
    if (request.employee.isOwner) {
      const [location] = await this.db
        .select({ id: tables.location.id })
        .from(tables.location)
        .where(
          and(eq(tables.location.merchantId, request.employee.merchantId), eq(tables.location.id, request.locationId)),
        )
        .limit(1);

      if (!location) {
        return failure({ kind: "location_not_found", locationId: request.locationId });
      }

      return ok(undefined);
    }

    const [locationAccess] = await this.db
      .select({ id: tables.locationAccess.id })
      .from(tables.locationAccess)
      .where(
        and(
          eq(tables.locationAccess.merchantId, request.employee.merchantId),
          eq(tables.locationAccess.employeeId, request.employee.id),
          eq(tables.locationAccess.locationId, request.locationId),
        ),
      )
      .limit(1);

    if (!locationAccess) {
      return failure({ kind: "location_access_denied", locationId: request.locationId });
    }

    return ok(undefined);
  }
}

export {
  EmployeeAuthorizationService,
  type AuthorizedEmployee,
  type AuthorizeLocationAccessRequest,
  type AuthorizePermissionRequest,
  type EmployeeAuthorizationFailure,
};
