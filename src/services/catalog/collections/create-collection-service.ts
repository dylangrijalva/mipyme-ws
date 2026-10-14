import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import { Collection } from "../../../contracts/collection.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { CollectionFinder } from "../../../finders/collection-finder.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { generateId } from "../../../utils/generate-id.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { slugify } from "../../../utils/slugify.ts";
import { BaseService } from "../../base-service.ts";

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
  publisher: Pick<RealtimeEventPublisher, "broadcast">;
  logger: Logger;
  db: Database;
  collectionFinder: CollectionFinder;
  user: CurrentUser;
};

const CreateCollectionRequest = z.object({ name: CollectionName });

type CreateCollectionRequest = z.infer<typeof CreateCollectionRequest>;

class CreateCollectionService extends BaseService<CreateCollectionRequest, Collection> {
  private readonly publisher: Pick<RealtimeEventPublisher, "broadcast">;
  private readonly db: Database;
  private readonly collectionFinder: CollectionFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    collectionFinder: CollectionFinder,
    user: CurrentUser,
    publisher: Pick<RealtimeEventPublisher, "broadcast">,
  ) {
    super(logger);
    this.publisher = publisher;
    this.db = db;
    this.collectionFinder = collectionFinder;
    this.user = user;
  }

  static create(dependencies: InjectedDependencies): CreateCollectionService {
    return new CreateCollectionService(
      dependencies.logger,
      dependencies.db,
      dependencies.collectionFinder,
      dependencies.user,
      dependencies.publisher,
    );
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

    if (await this.collectionFinder.exists(this.db, { merchantId: this.user.merchantId, slug })) {
      return err({
        code: codes.collectionNameAlreadyExists,
        message: "A collection with this name already exists. Choose another name.",
        details: [],
      });
    }

    const id = generateId({ model: "collection" });

    await this.db.insert(tables.collection).values({
      id,
      merchantId: this.user.merchantId,
      name: request.name,
      slug,
    });

    const collection = await this.collectionFinder.find(this.db, { id, merchantId: this.user.merchantId });

    return ok(Collection.parse(collection));
  }
}

export { CreateCollectionRequest, CreateCollectionService };
