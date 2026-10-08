import type { Logger } from "pino";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import type { CurrentUser } from "../../contracts/current-user.ts";
import type { Sale } from "../../contracts/sale.ts";
import type { Database } from "../../db/index.ts";
import { err, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  user: CurrentUser;
};

class VoidSaleService extends BaseService<string, Sale> {
  private readonly db: Database;
  private readonly user: CurrentUser;

  constructor(logger: Logger, db: Database, user: CurrentUser) {
    super(logger);
    this.db = db;
    this.user = user;
  }

  static create({ logger, db, user }: InjectedDependencies): VoidSaleService {
    return new VoidSaleService(logger, db, user);
  }

  async execute(id: string): Promise<Result<Sale, BusinessError>> {
    return err({
      code: codes.internalServerError,
      message: "API Method not implemented yet.",
      details: [],
    });
  }
}

export { VoidSaleService };
