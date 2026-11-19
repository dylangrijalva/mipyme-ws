import type { Logger } from "pino";
import z from "zod";
import type { BusinessError } from "../../../contracts/business-error.ts";
import { Collection } from "../../../contracts/collection.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { CollectionFinder } from "../../../finders/collection-finder.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { generateId } from "../../../utils/generate-id.ts";
import { ok, type Result } from "../../../utils/result.ts";
import { slugify } from "../../../utils/slugify.ts";
import { BaseService } from "../../base-service.ts";
import { handleCollectionWriteError } from "./collection-write-error.ts";

const CollectionName = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((name) => {
    const slug = slugify(name);
    return slug.length > 0 && slug.length <= 128;
  }, "Provide a name that produces a nonempty slug of at most 128 characters.");

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  collectionFinder: CollectionFinder;
  user: CurrentUser;
};

const CreateCollectionRequest = z.object({ name: CollectionName });

type CreateCollectionRequest = z.infer<typeof CreateCollectionRequest>;

class CreateCollectionService extends BaseService<CreateCollectionRequest, Collection> {
  private readonly db: Database;
  private readonly publisher: RealtimeEventPublisher;
  private readonly collectionFinder: CollectionFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    collectionFinder: CollectionFinder,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.publisher = publisher;
    this.collectionFinder = collectionFinder;
    this.user = user;
  }

  static create({ logger, db, collectionFinder, publisher, user }: InjectedDependencies): CreateCollectionService {
    return new CreateCollectionService(logger, db, collectionFinder, publisher, user);
  }

  async execute(request: CreateCollectionRequest): Promise<Result<Collection, BusinessError>> {
    const result = await this.createCollection(request);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "collection", snapshot: result.value },
      });
    }

    return result;
  }

  private async createCollection(request: CreateCollectionRequest): Promise<Result<Collection, BusinessError>> {
    const slug = slugify(request.name);

    const id = generateId({ model: "collection" });

    const conflict = await this.db
      .insert(tables.collection)
      .values({
        id,
        merchantId: this.user.merchantId,
        name: request.name,
        slug,
      })
      .then(() => undefined, handleCollectionWriteError);
    if (conflict) {
      return conflict;
    }

    const collection = await this.collectionFinder.find(this.db, { id, merchantId: this.user.merchantId });

    return ok(Collection.parse(collection));
  }
}

export { CreateCollectionRequest, CreateCollectionService };
