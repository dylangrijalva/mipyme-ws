import type { Logger } from "pino";
import z from "zod";
import type { BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { Employee } from "../../../contracts/employee.ts";
import { EmployeeStatus } from "../../../contracts/employee-status.ts";
import { PaginationRequest } from "../../../contracts/pagination-query.ts";
import type { PaginationResponse } from "../../../contracts/pagination-response.ts";
import type { Database } from "../../../db/index.ts";
import type { EmployeeFinder } from "../../../finders/employee-finder.ts";
import { ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";

const EmployeePaginationRequest = PaginationRequest.extend({
  status: EmployeeStatus.optional(),
});

type EmployeePaginationRequest = z.infer<typeof EmployeePaginationRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  employeeFinder: EmployeeFinder;
  user: CurrentUser;
};

class ListEmployeesService extends BaseService<EmployeePaginationRequest, PaginationResponse<Employee>> {
  private readonly db: Database;
  private readonly employeeFinder: EmployeeFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, employeeFinder: EmployeeFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.employeeFinder = employeeFinder;
    this.user = user;
  }

  static create({ logger, db, employeeFinder, user }: InjectedDependencies): ListEmployeesService {
    return new ListEmployeesService(logger, db, employeeFinder, user);
  }

  async execute(request: EmployeePaginationRequest): Promise<Result<PaginationResponse<Employee>, BusinessError>> {
    const { status, ...pagination } = request;
    const statuses: Array<EmployeeStatus> = status ? [status] : ["enabled", "disabled"];
    const response = await this.employeeFinder.paginate(this.db, {
      ...pagination,
      merchantId: this.user.merchantId,
      statuses,
    });

    return ok(response);
  }
}

export { EmployeePaginationRequest, ListEmployeesService };
