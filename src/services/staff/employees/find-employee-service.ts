import type { Logger } from "pino";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { Employee } from "../../../contracts/employee.ts";
import type { Database } from "../../../db/index.ts";
import type { EmployeeFinder } from "../../../finders/employee-finder.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  employeeFinder: EmployeeFinder;
  user: CurrentUser;
};

class FindEmployeeService extends BaseService<string, Employee> {
  private readonly db: Database;
  private readonly employeeFinder: EmployeeFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, employeeFinder: EmployeeFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.employeeFinder = employeeFinder;
    this.user = user;
  }

  static create({ logger, db, employeeFinder, user }: InjectedDependencies): FindEmployeeService {
    return new FindEmployeeService(logger, db, employeeFinder, user);
  }

  async execute(id: string): Promise<Result<Employee, BusinessError>> {
    const employee = await this.employeeFinder.find(this.db, { id, merchantId: this.user.merchantId });
    if (!employee) {
      return err({ code: codes.resourceNotFound, message: `Employee ${id} has not been found.`, details: [] });
    }

    return ok(employee);
  }
}

export { FindEmployeeService };
