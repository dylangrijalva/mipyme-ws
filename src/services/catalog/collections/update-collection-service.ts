import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import { Collection } from "../../../contracts/collection.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { CollectionFinder } from "../../../finders/collection-finder.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { hasDefinedValues } from "../../../utils/has-defined-values.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { slugify } from "../../../utils/slugify.ts";
import { BaseService } from "../../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  collectionFinder: CollectionFinder;
  user: CurrentUser;
};

const UpdateCollectionRequest = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine((name) => {
      const slug = slugify(name);
      return slug.length > 0 && slug.length <= 128;
    }, "Provide a name that produces a nonempty slug of at most 128 characters.")
    .optional(),
});

type UpdateCollectionRequest = z.infer<typeof UpdateCollectionRequest>;

class UpdateCollectionService extends BaseService<[string, UpdateCollectionRequest], Collection> {
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

  static create({ logger, db, collectionFinder, publisher, user }: InjectedDependencies): UpdateCollectionService {
    return new UpdateCollectionService(logger, db, collectionFinder, publisher, user);
  }

  async execute([id, request]: [string, UpdateCollectionRequest]): Promise<Result<Collection, BusinessError>> {
    const result = await this.updateCollection([id, request]);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "collection", snapshot: result.value },
      });
    }

    return result;
  }

  private async updateCollection([id, request]: [string, UpdateCollectionRequest]): Promise<
    Result<Collection, BusinessError>
  > {
    const collection = await this.collectionFinder.find(this.db, { id, merchantId: this.user.merchantId });

    if (!collection) {
      return err({
        code: codes.resourceNotFound,
        message: `Collection ${id} has not been found.`,
        details: [],
      });
    }

    if (!hasDefinedValues(request)) {
      return ok(collection);
    }

    const slug = slugify(request.name ?? collection.name);

    const duplicate = await this.collectionFinder.find(this.db, { merchantId: this.user.merchantId, slug });
    if (duplicate && duplicate.id !== id) {
      return err({
        code: codes.collectionNameAlreadyExists,
        message: "A collection with this name already exists. Choose another name.",
        details: [],
      });
    }

    await this.db
      .update(tables.collection)
      .set({ name: request.name, slug })
      .where(and(eq(tables.collection.id, id), eq(tables.collection.merchantId, this.user.merchantId)));

    const updatedCollection = await this.collectionFinder.find(this.db, { id, merchantId: this.user.merchantId });

    return ok(Collection.parse(updatedCollection));
  }
}

export { UpdateCollectionRequest, UpdateCollectionService };
