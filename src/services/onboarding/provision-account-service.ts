import { eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import { BusinessType } from "../../contracts/business-type.ts";
import { CountryIsoCode } from "../../contracts/country-iso-code.ts";
import type { IdentityAccount } from "../../contracts/identity-account.ts";
import type { JsonWebTokenPayload } from "../../contracts/json-web-token-payload.ts";
import type { Merchant } from "../../contracts/merchant.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { MerchantFinder } from "../../finders/merchant-finder.ts";
import type { IdentityProvider } from "../../integrations/identity-provider.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { generateId } from "../../utils/generate-id.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  identity: IdentityProvider;
  merchantFinder: MerchantFinder;
  claims: JsonWebTokenPayload;
};

const OnboardAccountRequest = z.object({
  name: z.string().trim().nonempty().max(64),
  country: CountryIsoCode,
  location: z.object({
    name: z.string().trim().nonempty().max(64),
    businessType: BusinessType.default("other"),
  }),
});

type OnboardAccountRequest = z.infer<typeof OnboardAccountRequest>;

class ProvisionAccountService extends BaseService<OnboardAccountRequest, Merchant> {
  private readonly db: Database;
  private readonly identity: IdentityProvider;
  private readonly merchantFinder: MerchantFinder;
  private readonly claims: JsonWebTokenPayload;

  constructor(
    logger: Logger,
    db: Database,
    identity: IdentityProvider,
    merchantFinder: MerchantFinder,
    claims: JsonWebTokenPayload,
  ) {
    super(logger);
    this.db = db;
    this.identity = identity;
    this.merchantFinder = merchantFinder;
    this.claims = claims;
  }

  static create({ logger, db, identity, merchantFinder, claims }: InjectedDependencies): ProvisionAccountService {
    return new ProvisionAccountService(logger, db, identity, merchantFinder, claims);
  }

  async execute(request: OnboardAccountRequest): Promise<Result<Merchant, BusinessError>> {
    const { success, value: identityAccount, error } = await this.identity.find(this.claims.sub);
    if (!success) {
      return err(error);
    }

    const [existingAccount] = await this.db
      .select({ merchantId: tables.account.merchantId, employee: tables.employee })
      .from(tables.account)
      .innerJoin(tables.employee, eq(tables.employee.accountId, tables.account.id))
      .where(eq(tables.account.externalId, this.claims.sub))
      .limit(1);

    const merchant = existingAccount
      ? await assertFound(this.merchantFinder.find(this.db, existingAccount.merchantId))
      : await this.createMerchant(request, identityAccount);

    const [account] = await this.db
      .select({ merchantId: tables.account.merchantId, employee: tables.employee })
      .from(tables.account)
      .innerJoin(tables.employee, eq(tables.employee.accountId, tables.account.id))
      .where(eq(tables.account.externalId, this.claims.sub))
      .limit(1);

    if (!account.employee.isOwner) {
      return err({
        code: codes.conflictError,
        message: "This account already belongs to an employee and cannot provision a business.",
        details: [],
      });
    }

    const { success: assigned, error: assignmentError } = await this.identity.assignToMerchant({
      accountId: this.claims.sub,
      name: account.employee.name,
      merchantId: merchant.id,
      employeeId: account.employee.id,
      accountType: "owner",
    });

    if (!assigned) {
      return err(assignmentError);
    }

    return ok(merchant);
  }

  private async createMerchant(request: OnboardAccountRequest, identityAccount: IdentityAccount): Promise<Merchant> {
    return this.db.transaction(async (trx) => {
      const merchantId = generateId({ model: "merchant" });
      const accountId = generateId({ model: "account" });

      await trx.insert(tables.merchant).values({
        id: merchantId,
        name: request.location.name,
        country: request.country,
      });

      await trx
        .insert(tables.account)
        .values({ id: accountId, externalId: identityAccount.id, email: identityAccount.email!, merchantId })
        .onDuplicateKeyUpdate({
          set: {
            externalId: sql`${tables.account.externalId}`,
            updatedAt: sql`${tables.account.updatedAt}`,
          },
        });

      const [account] = await assertFound(
        trx
          .select({ id: tables.account.id, merchantId: tables.account.merchantId })
          .from(tables.account)
          .where(eq(tables.account.externalId, identityAccount.id))
          .limit(1)
          .for("update"),
      );

      if (account.merchantId !== merchantId) {
        await trx.delete(tables.merchant).where(eq(tables.merchant.id, merchantId));
        return assertFound(this.merchantFinder.find(trx, account.merchantId));
      }

      await trx.insert(tables.employee).values({
        id: generateId({ model: "employee" }),
        name: request.name,
        merchantId,
        accountId: account.id,
        isOwner: true,
        status: "enabled",
      });

      await trx.insert(tables.location).values({
        id: generateId({ model: "location" }),
        name: request.location.name,
        businessType: request.location.businessType,
        merchantId,
      });

      return assertFound(this.merchantFinder.find(trx, merchantId));
    });
  }
}

export { OnboardAccountRequest, ProvisionAccountService };
