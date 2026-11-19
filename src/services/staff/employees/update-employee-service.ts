import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { Employee } from "../../../contracts/employee.ts";
import { EmployeePin } from "../../../contracts/employee-pin.ts";
import { EmployeeStatus } from "../../../contracts/employee-status.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { EmployeeFinder } from "../../../finders/employee-finder.ts";
import type { IdentityProvider } from "../../../integrations/identity-provider.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../../utils/assert-found.ts";
import { hasDefinedValues } from "../../../utils/has-defined-values.ts";
import { now } from "../../../utils/now.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";
import {
  EmployeeLocationIds,
  type EmployeeManagement,
  EmployeePermissions,
  MaxDiscountRate,
  PIN_ALREADY_EXISTS,
  PIN_HOLDING_STATUSES,
} from "./employee-management.ts";

const UpdateEmployeeRequest = z.object({
  name: z.string().trim().nonempty().max(128).optional(),
  pin: EmployeePin.optional(),
  permissions: EmployeePermissions.optional(),
  maxDiscountRate: MaxDiscountRate.optional(),
  locationIds: EmployeeLocationIds.optional(),
  status: EmployeeStatus.optional(),
});

type UpdateEmployeeRequest = z.infer<typeof UpdateEmployeeRequest>;

type StoredEmployee = typeof tables.employee.$inferSelect;

type UpdateOutcome = {
  employee: Employee;
  releasedExternalId: string | null;
};

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  identity: IdentityProvider;
  publisher: RealtimeEventPublisher;
  employeeFinder: EmployeeFinder;
  user: CurrentUser;
  employeeManagement: EmployeeManagement;
};

class UpdateEmployeeService extends BaseService<[string, UpdateEmployeeRequest], Employee> {
  private readonly db: Database;
  private readonly employeeManagement: EmployeeManagement;
  private readonly identity: IdentityProvider;
  private readonly publisher: RealtimeEventPublisher;
  private readonly employeeFinder: EmployeeFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    identity: IdentityProvider,
    employeeFinder: EmployeeFinder,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
    employeeManagement: EmployeeManagement,
  ) {
    super(logger);
    this.db = db;
    this.employeeManagement = employeeManagement;
    this.identity = identity;
    this.publisher = publisher;
    this.employeeFinder = employeeFinder;
    this.user = user;
  }

  static create({
    logger,
    db,
    identity,
    employeeFinder,
    publisher,
    user,
    employeeManagement,
  }: InjectedDependencies): UpdateEmployeeService {
    return new UpdateEmployeeService(logger, db, identity, employeeFinder, publisher, user, employeeManagement);
  }

  async execute([id, request]: [string, UpdateEmployeeRequest]): Promise<Result<Employee, BusinessError>> {
    const merchantId = this.user.merchantId;
    const [target] = await this.db
      .select()
      .from(tables.employee)
      .where(and(eq(tables.employee.merchantId, merchantId), eq(tables.employee.id, id)))
      .limit(1);

    if (!target) {
      return err({ code: codes.resourceNotFound, message: `Employee ${id} has not been found.`, details: [] });
    }

    const authorization = await this.authorize(target, request);
    if (!authorization.success) {
      return authorization;
    }

    if (!hasDefinedValues(request)) {
      return ok(await assertFound(this.employeeFinder.find(this.db, { merchantId, id })));
    }

    const outcome = await this.db.transaction((trx) => this.updateEmployee(trx, id, request));
    if (!outcome.success) {
      return outcome;
    }

    const { employee, releasedExternalId } = outcome.value;
    this.publisher.broadcast({ merchantId, resource: { type: "employee", snapshot: employee } });
    if (releasedExternalId) {
      await this.clearReleasedLogin(id, releasedExternalId);
    }

    return ok(employee);
  }

  private async authorize(
    target: StoredEmployee,
    request: UpdateEmployeeRequest,
  ): Promise<Result<void, BusinessError>> {
    const changesOnlyPin =
      request.pin !== undefined &&
      Object.entries(request).every(([field, value]) => field === "pin" || value === undefined);
    const isOwnPinChange = target.id === this.user.employeeId && changesOnlyPin;
    if (isOwnPinChange) {
      return ok(undefined);
    }

    const authorization = await this.employeeManagement.authorize(this.db, this.user);
    if (!authorization.success) {
      return authorization;
    }

    if (!target.isOwner) {
      return ok(undefined);
    }

    if (this.user.accountType !== "owner") {
      return err({
        code: codes.forbiddenError,
        message: "Only the owner can update the owner's employee.",
        details: [],
      });
    }

    const changesOwnerAccess = [request.status, request.permissions, request.maxDiscountRate, request.locationIds].some(
      (value) => value !== undefined,
    );
    if (changesOwnerAccess) {
      return err({
        code: codes.validationError,
        message: "Only the name and PIN of the owner can be changed.",
        details: [],
      });
    }

    return ok(undefined);
  }

  private async updateEmployee(
    trx: Database,
    id: string,
    request: UpdateEmployeeRequest,
  ): Promise<Result<UpdateOutcome, BusinessError>> {
    const merchantId = this.user.merchantId;
    await this.employeeManagement.lockMerchant(trx, merchantId);

    const [current] = await trx
      .select()
      .from(tables.employee)
      .where(and(eq(tables.employee.merchantId, merchantId), eq(tables.employee.id, id)))
      .for("update");

    const nextStatus = request.status ?? current.status;
    const nextPin = request.pin ?? current.pin;
    const isArchiving = current.status !== "archived" && nextStatus === "archived";
    const isRestoring = current.status === "archived" && nextStatus !== "archived";
    const reservesPin = nextStatus !== "archived" && (nextPin !== current.pin || isRestoring);
    if (reservesPin) {
      const isPinTaken = await this.employeeFinder.exists(trx, {
        merchantId,
        pin: nextPin,
        statuses: PIN_HOLDING_STATUSES,
        excludedId: id,
      });
      if (isPinTaken) {
        return err(PIN_ALREADY_EXISTS);
      }
    }

    if (request.locationIds) {
      const locations = await this.employeeManagement.assertLocationsExist(trx, merchantId, request.locationIds);
      if (!locations.success) {
        return locations;
      }
    }

    const updatedAt = now();
    await trx
      .update(tables.employee)
      .set({
        name: request.name,
        pin: request.pin,
        permissions: request.permissions
          ? this.employeeManagement.serializePermissions(request.permissions)
          : undefined,
        maxDiscountRate: request.maxDiscountRate,
        status: request.status,
        accountId: isArchiving ? null : undefined,
        updatedAt,
      })
      .where(and(eq(tables.employee.merchantId, merchantId), eq(tables.employee.id, id)));

    if (request.locationIds) {
      await this.employeeManagement.replaceLocationAccess(trx, {
        merchantId,
        employeeId: id,
        locationIds: request.locationIds,
      });
    }

    const releasedExternalId = isArchiving ? await this.releaseArchivedEmployee(trx, current, updatedAt) : null;
    const employee = await assertFound(this.employeeFinder.find(trx, { merchantId, id }));
    return ok({ employee, releasedExternalId });
  }

  private async clearReleasedLogin(employeeId: string, externalId: string): Promise<void> {
    const removal = await this.identity
      .removeFromMerchant(externalId)
      .catch((exception: unknown) => err({ code: codes.internalServerError, message: String(exception), details: [] }));

    if (!removal.success) {
      this.logger.warn({ employeeId, error: removal.error }, "The released account kept its merchant metadata");
    }
  }

  private async releaseArchivedEmployee(
    trx: Database,
    employee: StoredEmployee,
    archivedAt: Date,
  ): Promise<string | null> {
    await trx
      .update(tables.employeeInvitation)
      .set({ status: "revoked", revokedAt: archivedAt, updatedAt: archivedAt })
      .where(
        and(
          eq(tables.employeeInvitation.merchantId, employee.merchantId),
          eq(tables.employeeInvitation.employeeId, employee.id),
          eq(tables.employeeInvitation.status, "invited"),
        ),
      );

    if (!employee.accountId) {
      return null;
    }

    const accountCondition = and(
      eq(tables.account.merchantId, employee.merchantId),
      eq(tables.account.id, employee.accountId),
    );
    const [account] = await trx
      .select({ externalId: tables.account.externalId })
      .from(tables.account)
      .where(accountCondition);
    await trx.delete(tables.account).where(accountCondition);
    return account?.externalId ?? null;
  }
}

export { UpdateEmployeeRequest, UpdateEmployeeService };
