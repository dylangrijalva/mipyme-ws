import Big from "big.js";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import { BusinessType } from "../../contracts/business-type.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import { Decimal } from "../../contracts/decimal.ts";
import type { Location } from "../../contracts/location.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { LocationFinder } from "../../finders/location-finder.ts";
import type { RealtimeEventPublisher } from "../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { generateId } from "../../utils/generate-id.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

const LocationRate = Decimal.pipe(
  z.string().refine((value) => new Big(value).lt("10000000000"), "Provide a rate below 10000000000."),
);

const CreateLocationRequest = z.object({
  name: z.string().trim().nonempty().max(128),
  businessType: BusinessType,
  phone: z.string().trim().nonempty().max(32).nullish(),
  address: z.string().trim().nonempty().max(256).nullish(),
  taxId: z.string().trim().nonempty().max(32).nullish(),
  taxRate: LocationRate.nullish(),
  exchangeRate: LocationRate.optional(),
  allowBackorders: z.boolean().optional(),
  receiptHeaderText: z.string().trim().nonempty().max(256).nullish(),
  receiptFooterText: z.string().trim().nonempty().max(256).nullish(),
});

type CreateLocationRequest = z.infer<typeof CreateLocationRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  locationFinder: LocationFinder;
  user: CurrentUser;
};

class CreateLocationService extends BaseService<CreateLocationRequest, Location> {
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

  static create({ logger, db, locationFinder, publisher, user }: InjectedDependencies): CreateLocationService {
    return new CreateLocationService(logger, db, locationFinder, publisher, user);
  }

  async execute(request: CreateLocationRequest): Promise<Result<Location, BusinessError>> {
    if (this.user.accountType !== "owner") {
      return err({ code: codes.forbiddenError, message: "Only owners can create locations.", details: [] });
    }

    const result = await this.createLocation(request);
    if (result.success) {
      this.publisher.broadcast({
        merchantId: this.user.merchantId,
        resource: { type: "location", snapshot: result.value },
      });
    }

    return result;
  }

  private async createLocation(request: CreateLocationRequest): Promise<Result<Location, BusinessError>> {
    return this.db.transaction(async (trx): Promise<Result<Location, BusinessError>> => {
      await trx
        .select({ id: tables.merchant.id })
        .from(tables.merchant)
        .where(eq(tables.merchant.id, this.user.merchantId))
        .for("update");
      const locations = await trx
        .select({ id: tables.location.id })
        .from(tables.location)
        .where(eq(tables.location.merchantId, this.user.merchantId))
        .limit(3)
        .for("update");
      if (locations.length >= 3) {
        return err({
          code: codes.locationLimitExceeded,
          message: "You can create up to 3 locations per merchant.",
          details: [],
        });
      }

      const id = generateId({ model: "location" });
      await trx.insert(tables.location).values({
        id,
        merchantId: this.user.merchantId,
        name: request.name,
        businessType: request.businessType,
        phone: request.phone ?? null,
        address: request.address ?? null,
        taxId: request.taxId ?? null,
        taxRate: request.taxRate === undefined ? "0.00" : request.taxRate,
        exchangeRate: request.exchangeRate ?? "0.00",
        allowBackorders: request.allowBackorders ?? false,
        receiptHeaderText: request.receiptHeaderText ?? null,
        receiptFooterText: request.receiptFooterText ?? null,
      });

      const location = await assertFound(this.locationFinder.find(trx, { id, merchantId: this.user.merchantId }));
      return ok(location);
    });
  }
}

export { CreateLocationRequest, CreateLocationService };
