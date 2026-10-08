import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import { Collection } from "../../contracts/collection.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Database } from "../../db/index.ts";
import type { CollectionFinder } from "../../finders/collection-finder.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  collectionFinder: CollectionFinder;
  user: CurrentUser;
};

class FindCollectionService extends BaseService<string, Collection> {
  private readonly db: Database;
  private readonly collectionFinder: CollectionFinder;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, collectionFinder: CollectionFinder, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.collectionFinder = collectionFinder;
    this.user = user;
  }

  static create(dependencies: InjectedDependencies): FindCollectionService {
    return new FindCollectionService(
      dependencies.logger,
      dependencies.db,
      dependencies.collectionFinder,
      dependencies.user,
    );
  }

  async execute(request: string): Promise<Result<Collection, BusinessError>> {
    const collection = await this.collectionFinder.find(this.db, {
      id: request,
      merchantId: this.user.merchantId,
    });

    if (!collection) {
      return err({
        code: codes.resourceNotFound,
        message: `Collection ${request} has not been found.`,
        details: [],
      });
    }

    return ok(collection);
  }
}

export { FindCollectionService };
