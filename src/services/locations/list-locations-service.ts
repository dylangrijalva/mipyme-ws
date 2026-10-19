import type { Logger } from "pino";
import type { BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Location } from "../../contracts/location.ts";
import type { PaginationRequest } from "../../contracts/pagination-query.ts";
import type { PaginationResponse } from "../../contracts/pagination-response.ts";
import type { Database } from "../../db/index.ts";
import type { LocationFinder } from "../../finders/location-finder.ts";
import { ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  locationFinder: LocationFinder;
  user: CurrentUser;
};

class ListLocationsService extends BaseService<PaginationRequest, PaginationResponse<Location>> {
  private readonly db: Database;
  private readonly locationFinder: LocationFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, locationFinder: LocationFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.locationFinder = locationFinder;
    this.user = user;
  }

  static create({ logger, db, locationFinder, user }: InjectedDependencies): ListLocationsService {
    return new ListLocationsService(logger, db, locationFinder, user);
  }

  async execute(request: PaginationRequest): Promise<Result<PaginationResponse<Location>, BusinessError>> {
    const response = await this.locationFinder.paginate(this.db, {
      ...request,
      merchantId: this.user.merchantId,
      employeeId: this.user.accountType === "owner" ? undefined : this.user.employeeId,
    });

    return ok(response);
  }
}

export { ListLocationsService };
