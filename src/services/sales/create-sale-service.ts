import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import { PositiveDecimal } from "../../contracts/decimal.ts";
import { ObjectId } from "../../contracts/object-id.ts";
import { PaymentMethod } from "../../contracts/payment-method.ts";
import type { Sale } from "../../contracts/sale.ts";
import type { Database } from "../../db/index.ts";
import { err, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

const CreateSaleRequest = z.object({
  locationId: ObjectId,
  lineItems: z
    .array(
      z.object({
        variantId: ObjectId,
        price: PositiveDecimal,
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, { message: "At least one line item is required." }),
  payments: z.array(
    z.object({
      method: PaymentMethod,
      amount: PositiveDecimal,
      exchangeRate: PositiveDecimal,
    }),
  ),
});

type CreateSaleRequest = z.infer<typeof CreateSaleRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  user: CurrentUser;
};

class CreateSaleService extends BaseService<CreateSaleRequest, Sale> {
  private readonly db: Database;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.user = user;
  }

  static create(deps: InjectedDependencies): CreateSaleService {
    return new CreateSaleService(deps.logger, deps.db, deps.user);
  }

  async execute(request: CreateSaleRequest): Promise<Result<Sale, BusinessError>> {
    return err({
      code: codes.internalServerError,
      message: "API Method not implemented yet.",
      details: [],
    });
  }
}

export { CreateSaleRequest, CreateSaleService };
