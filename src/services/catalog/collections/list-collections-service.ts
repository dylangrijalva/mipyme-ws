import type { Logger } from "pino";
import type { BusinessError } from "../../../contracts/business-error.ts";
import type { Collection } from "../../../contracts/collection.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { PaginationRequest } from "../../../contracts/pagination-query.ts";
import type { PaginationResponse } from "../../../contracts/pagination-response.ts";
import type { Database } from "../../../db/index.ts";
import type { CollectionFinder } from "../../../finders/collection-finder.ts";
import { ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  collectionFinder: CollectionFinder;
  user: CurrentUser;
};

class ListCollectionsService extends BaseService<PaginationRequest, PaginationResponse<Collection>> {
  private readonly db: Database;
  private readonly collectionFinder: CollectionFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, collectionFinder: CollectionFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.collectionFinder = collectionFinder;
    this.user = user;
  }

  static create({ logger, db, collectionFinder, user }: InjectedDependencies): ListCollectionsService {
    return new ListCollectionsService(logger, db, collectionFinder, user);
  }

  async execute(request: PaginationRequest): Promise<Result<PaginationResponse<Collection>, BusinessError>> {
    const response = await this.collectionFinder.paginate(this.db, {
      ...request,
      merchantId: this.user.merchantId,
    });

    return ok(response);
  }
}

export { ListCollectionsService };
