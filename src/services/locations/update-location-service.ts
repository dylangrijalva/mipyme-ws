import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import type z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Location } from "../../contracts/location.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { LocationFinder } from "../../finders/location-finder.ts";
import type { RealtimeEventPublisher } from "../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { hasDefinedValues } from "../../utils/has-defined-values.ts";
import { now } from "../../utils/now.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";
import { CreateLocationRequest } from "./create-location-service.ts";

const UpdateLocationRequest = CreateLocationRequest.partial();

type UpdateLocationRequest = z.infer<typeof UpdateLocationRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  locationFinder: LocationFinder;
  user: CurrentUser;
};

class UpdateLocationService extends BaseService<[string, UpdateLocationRequest], Location> {
  private readonly db: Database;
  private readonly publisher: RealtimeEventPublisher;
  private readonly locationFinder: LocationFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    locationFinder: LocationFinder,
    publisher: RealtimeEventPublisher,
    user: CurrentUser,
  ) {
    super(logger);
    this.db = db;
    this.publisher = publisher;
    this.locationFinder = locationFinder;
    this.user = user;
  }

  static create({ logger, db, locationFinder, publisher, user }: InjectedDependencies): UpdateLocationService {
    return new UpdateLocationService(logger, db, locationFinder, publisher, user);
  }

  async execute(request: [string, UpdateLocationRequest]): Promise<Result<Location, BusinessError>> {
    if (this.user.accountType !== "owner") {
      return err({ code: codes.forbiddenError, message: "Only owners can update locations.", details: [] });
    }

    const result = await this.updateLocation(request);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "location", snapshot: result.value },
      });
    }

    return result;
  }

  private async updateLocation(request: [string, UpdateLocationRequest]): Promise<Result<Location, BusinessError>> {
    const [id, values] = request;

    const location = await this.locationFinder.find(this.db, { id, merchantId: this.user.merchantId });
    if (!location) {
      return err({
        code: codes.resourceNotFound,
        message: `Location ${id} has not been found.`,
        details: [],
      });
    }

    if (!hasDefinedValues(values)) {
      return ok(location);
    }

    await this.db
      .update(tables.location)
      .set({ ...values, updatedAt: now() })
      .where(and(eq(tables.location.id, id), eq(tables.location.merchantId, this.user.merchantId)));

    const updatedLocation = await assertFound(
      this.locationFinder.find(this.db, { id, merchantId: this.user.merchantId }),
    );

    return ok(updatedLocation);
  }
}

export { UpdateLocationService, UpdateLocationRequest };
