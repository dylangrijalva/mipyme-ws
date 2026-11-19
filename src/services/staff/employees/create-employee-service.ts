import type { Logger } from "pino";
import z from "zod";
import type { BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { Employee } from "../../../contracts/employee.ts";
import { EmployeePin } from "../../../contracts/employee-pin.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { EmployeeFinder } from "../../../finders/employee-finder.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../../utils/assert-found.ts";
import { generateId } from "../../../utils/generate-id.ts";
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

const CreateEmployeeRequest = z.object({
  name: z.string().trim().nonempty().max(128),
  pin: EmployeePin,
  permissions: EmployeePermissions.default([]),
  maxDiscountRate: MaxDiscountRate.default("0.00"),
  locationIds: EmployeeLocationIds.default([]),
});

type CreateEmployeeRequest = z.infer<typeof CreateEmployeeRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  employeeFinder: EmployeeFinder;
  user: CurrentUser;
  employeeManagement: EmployeeManagement;
};

class CreateEmployeeService extends BaseService<CreateEmployeeRequest, Employee> {
  private readonly db: Database;
  private readonly employeeManagement: EmployeeManagement;
  private readonly publisher: RealtimeEventPublisher;
  private readonly employeeFinder: EmployeeFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    employeeFinder: EmployeeFinder,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
    employeeManagement: EmployeeManagement,
  ) {
    super(logger);
    this.db = db;
    this.employeeManagement = employeeManagement;
    this.publisher = publisher;
    this.employeeFinder = employeeFinder;
    this.user = user;
  }

  static create({
    logger,
    db,
    employeeFinder,
    publisher,
    user,
    employeeManagement,
  }: InjectedDependencies): CreateEmployeeService {
    return new CreateEmployeeService(logger, db, employeeFinder, publisher, user, employeeManagement);
  }

  async execute(request: CreateEmployeeRequest): Promise<Result<Employee, BusinessError>> {
    const authorization = await this.employeeManagement.authorize(this.db, this.user);
    if (!authorization.success) {
      return authorization;
    }

    const result = await this.createEmployee(request);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "employee", snapshot: result.value },
      });
    }

    return result;
  }

  private async createEmployee(request: CreateEmployeeRequest): Promise<Result<Employee, BusinessError>> {
    return this.db.transaction(async (trx): Promise<Result<Employee, BusinessError>> => {
      const merchantId = this.user.merchantId;
      await this.employeeManagement.lockMerchant(trx, merchantId);

      const isPinTaken = await this.employeeFinder.exists(trx, {
        merchantId,
        pin: request.pin,
        statuses: PIN_HOLDING_STATUSES,
      });
      if (isPinTaken) {
        return err(PIN_ALREADY_EXISTS);
      }

      const locations = await this.employeeManagement.assertLocationsExist(trx, merchantId, request.locationIds);
      if (!locations.success) {
        return locations;
      }

      const id = generateId({ model: "employee" });
      await trx.insert(tables.employee).values({
        id,
        merchantId,
        name: request.name,
        pin: request.pin,
        isOwner: false,
        status: "enabled",
        permissions: this.employeeManagement.serializePermissions(request.permissions),
        maxDiscountRate: request.maxDiscountRate,
      });
      await this.employeeManagement.replaceLocationAccess(trx, {
        merchantId,
        employeeId: id,
        locationIds: request.locationIds,
      });

      return ok(await assertFound(this.employeeFinder.find(trx, { merchantId, id })));
    });
  }
}

export { CreateEmployeeRequest, CreateEmployeeService };
