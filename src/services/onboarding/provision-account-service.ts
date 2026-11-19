import { eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import { BusinessType } from "../../contracts/business-type.ts";
import type { IdentityAccount } from "../../contracts/identity-account.ts";
import type { JsonWebTokenPayload } from "../../contracts/json-web-token-payload.ts";
import type { Merchant } from "../../contracts/merchant.ts";
import { PHONE_NUMBER_REGEX } from "../../contracts/regexs.ts";
import type { Database } from "../../db/index.ts";
import { tables } from "../../db/schema.ts";
import type { EmployeeFinder } from "../../finders/employee-finder.ts";
import type { MerchantFinder } from "../../finders/merchant-finder.ts";
import type { IdentityProvider } from "../../integrations/identity-provider.ts";
import { assertFound } from "../../utils/assert-found.ts";
import { generateId } from "../../utils/generate-id.ts";
import { resolvePhoneNumberCountry } from "../../utils/resolve-phone-number-country.ts";
import { err, ok, type Result } from "../../utils/result.ts";
import { BaseService } from "../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  identity: IdentityProvider;
  merchantFinder: MerchantFinder;
  employeeFinder: EmployeeFinder;
  claims: JsonWebTokenPayload;
};

const PHONE_NUMBER_ALREADY_EXISTS: BusinessError = Object.freeze({
  code: codes.phoneNumberAlreadyExists,
  message: "The phone number is already in use by another account.",
  details: [],
});

const OnboardAccountRequest = z
  .object({
    name: z.string().trim().nonempty().max(64),
    phone: z
      .string()
      .trim()
      .regex(PHONE_NUMBER_REGEX, "The phone number must be in E.164 format, for example +573001234567."),
    location: z.object({
      name: z.string().trim().nonempty().max(64),
      businessType: BusinessType.default("other"),
    }),
  })
  .transform((request, ctx) => {
    const country = resolvePhoneNumberCountry(request.phone);
    if (!country) {
      ctx.issues.push({
        code: "custom",
        message: "The phone number must belong to a supported country.",
        input: request.phone,
        path: ["phone"],
      });
      return z.NEVER;
    }

    return { ...request, country };
  });

type OnboardAccountRequest = z.infer<typeof OnboardAccountRequest>;

class ProvisionAccountService extends BaseService<OnboardAccountRequest, Merchant> {
  private readonly db: Database;
  private readonly identity: IdentityProvider;
  private readonly merchantFinder: MerchantFinder;
  private readonly employeeFinder: EmployeeFinder;
  private readonly claims: JsonWebTokenPayload;

  constructor(
    logger: Logger,
    db: Database,
    identity: IdentityProvider,
    merchantFinder: MerchantFinder,
    employeeFinder: EmployeeFinder,
    claims: JsonWebTokenPayload,
  ) {
    super(logger);
    this.db = db;
    this.identity = identity;
    this.merchantFinder = merchantFinder;
    this.employeeFinder = employeeFinder;
    this.claims = claims;
  }

  static create({
    logger,
    db,
    identity,
    merchantFinder,
    employeeFinder,
    claims,
  }: InjectedDependencies): ProvisionAccountService {
    return new ProvisionAccountService(logger, db, identity, merchantFinder, employeeFinder, claims);
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

    const {
      success: provisioned,
      value: merchant,
      error: provisioningError,
    } = existingAccount
      ? ok(await assertFound(this.merchantFinder.find(this.db, existingAccount.merchantId)))
      : await this.provisionMerchant(request, identityAccount);

    if (!provisioned) {
      return err(provisioningError);
    }

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

  private async provisionMerchant(
    request: OnboardAccountRequest,
    identityAccount: IdentityAccount,
  ): Promise<Result<Merchant, BusinessError>> {
    const isPhoneTaken = await this.employeeFinder.exists(this.db, { phone: request.phone });
    if (isPhoneTaken) {
      return err(PHONE_NUMBER_ALREADY_EXISTS);
    }

    return this.createMerchant(request, identityAccount);
  }

  private async createMerchant(
    request: OnboardAccountRequest,
    identityAccount: IdentityAccount,
  ): Promise<Result<Merchant, BusinessError>> {
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
        .values({
          id: accountId,
          externalId: identityAccount.id,
          email: identityAccount.email!,
          phone: request.phone,
          merchantId,
        })
        .onDuplicateKeyUpdate({
          set: {
            externalId: sql`${tables.account.externalId}`,
            updatedAt: sql`${tables.account.updatedAt}`,
          },
        });

      const [account] = await trx
        .select({ id: tables.account.id, merchantId: tables.account.merchantId })
        .from(tables.account)
        .where(eq(tables.account.externalId, identityAccount.id))
        .limit(1)
        .for("update");

      // The upsert also absorbs a collision on the phone unique index, leaving no account for this
      // identity; that only happens when a concurrent signup claimed the same number first.
      if (!account) {
        await trx.delete(tables.merchant).where(eq(tables.merchant.id, merchantId));
        return err(PHONE_NUMBER_ALREADY_EXISTS);
      }

      if (account.merchantId !== merchantId) {
        await trx.delete(tables.merchant).where(eq(tables.merchant.id, merchantId));
        return ok(await assertFound(this.merchantFinder.find(trx, account.merchantId)));
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

      return ok(await assertFound(this.merchantFinder.find(trx, merchantId)));
    });
  }
}

export { OnboardAccountRequest, ProvisionAccountService };
