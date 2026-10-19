import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Location } from "../../contracts/location.ts";
import type { Database } from "../../db/index.ts";
import type { LocationFinder } from "../../finders/location-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  locationFinder: LocationFinder;
  user: CurrentUser;
};

class FindLocationService extends BaseService<string, Location> {
  private readonly db: Database;
  private readonly locationFinder: LocationFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, locationFinder: LocationFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.locationFinder = locationFinder;
    this.user = user;
  }

  static create({ logger, db, locationFinder, user }: InjectedDependencies): FindLocationService {
    return new FindLocationService(logger, db, locationFinder, user);
  }

  async execute(id: string): Promise<Result<Location, BusinessError>> {
    const location = await this.locationFinder.find(this.db, {
      id,
      merchantId: this.user.merchantId,
      employeeId: this.user.accountType === "owner" ? undefined : this.user.employeeId,
    });

    if (!location) {
      return err({
        code: codes.resourceNotFound,
        message: `Location ${id} has not been found.`,
        details: [],
      });
    }

    return ok(location);
  }
}

export { FindLocationService };
