import { and, eq, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import type { Employee } from "../../../contracts/employee.ts";
import type { JsonWebTokenPayload } from "../../../contracts/json-web-token-payload.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { EmployeeFinder } from "../../../finders/employee-finder.ts";
import type { IdentityProvider } from "../../../integrations/identity-provider.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../../utils/assert-found.ts";
import { generateId } from "../../../utils/generate-id.ts";
import { normalizeEmail } from "../../../utils/normalize-email.ts";
import { now } from "../../../utils/now.ts";
import { resolveInvitationStatus } from "../../../utils/resolve-invitation-status.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";
import type { EmployeeManagement } from "../employees/employee-management.ts";

type StoredInvitation = typeof tables.employeeInvitation.$inferSelect;

type StoredEmployee = typeof tables.employee.$inferSelect;

type AcceptOutcome = {
  employee: Employee;
  merchantId: string;
  accepted: boolean;
};

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  identity: IdentityProvider;
  publisher: RealtimeEventPublisher;
  employeeFinder: EmployeeFinder;
  claims: JsonWebTokenPayload;
  employeeManagement: EmployeeManagement;
};

const INVITATION_NOT_FOUND: BusinessError = Object.freeze({
  code: codes.resourceNotFound,
  message: "The invitation has not been found.",
  details: [],
});

class AcceptInvitationService extends BaseService<string, Employee> {
  private readonly db: Database;
  private readonly employeeManagement: EmployeeManagement;
  private readonly identity: IdentityProvider;
  private readonly publisher: RealtimeEventPublisher;
  private readonly employeeFinder: EmployeeFinder;
  private readonly claims: JsonWebTokenPayload;

  constructor(
    logger: Logger,
    db: Database,
    identity: IdentityProvider,
    publisher: RealtimeEventPublisher,
    employeeFinder: EmployeeFinder,
    claims: JsonWebTokenPayload,
    employeeManagement: EmployeeManagement,
  ) {
    super(logger);
    this.db = db;
    this.employeeManagement = employeeManagement;
    this.identity = identity;
    this.publisher = publisher;
    this.employeeFinder = employeeFinder;
    this.claims = claims;
  }

  static create({
    logger,
    db,
    identity,
    publisher,
    employeeFinder,
    claims,
    employeeManagement,
  }: InjectedDependencies): AcceptInvitationService {
    return new AcceptInvitationService(logger, db, identity, publisher, employeeFinder, claims, employeeManagement);
  }

  async execute(invitationId: string): Promise<Result<Employee, BusinessError>> {
    const [target] = await this.db
      .select({ merchantId: tables.employeeInvitation.merchantId })
      .from(tables.employeeInvitation)
      .where(eq(tables.employeeInvitation.id, invitationId))
      .limit(1);
    if (!target) {
      return err(INVITATION_NOT_FOUND);
    }

    const result = await this.db.transaction((trx) => this.accept(trx, invitationId, target.merchantId));
    if (!result.success) {
      return result;
    }

    const { employee, merchantId, accepted } = result.value;
    if (accepted) {
      this.publisher.broadcast({ merchantId, resource: { type: "employee", snapshot: employee } });
    }

    const assignment = await this.identity.assignToMerchant({
      accountId: this.claims.sub,
      name: employee.name,
      merchantId,
      employeeId: employee.id,
      accountType: "staff",
    });

    if (!assignment.success) {
      return err(assignment.error);
    }

    return ok(employee);
  }

  private async accept(
    trx: Database,
    invitationId: string,
    merchantId: string,
  ): Promise<Result<AcceptOutcome, BusinessError>> {
    await this.employeeManagement.lockMerchant(trx, merchantId);
    const [invitation] = await trx
      .select()
      .from(tables.employeeInvitation)
      .where(eq(tables.employeeInvitation.id, invitationId))
      .for("update");

    if (!invitation || invitation.email !== normalizeEmail(this.claims.email)) {
      return err(INVITATION_NOT_FOUND);
    }

    const [employee] = await trx
      .select()
      .from(tables.employee)
      .where(and(eq(tables.employee.merchantId, merchantId), eq(tables.employee.id, invitation.employeeId)))
      .for("update");

    if (invitation.status === "accepted") {
      return this.replayAcceptance(trx, employee);
    }

    const status = resolveInvitationStatus(invitation);
    if (status === "revoked") {
      return err({ code: codes.conflictError, message: "The invitation has been revoked.", details: [] });
    }

    if (status === "expired") {
      return err({ code: codes.conflictError, message: "The invitation has expired.", details: [] });
    }

    if (employee.status === "archived") {
      return err({ code: codes.conflictError, message: "The employee has been archived.", details: [] });
    }

    if (employee.accountId) {
      return err({ code: codes.conflictError, message: "The employee already has an account.", details: [] });
    }

    return this.linkAccount(trx, invitation, employee);
  }

  private async linkAccount(
    trx: Database,
    invitation: StoredInvitation,
    employee: StoredEmployee,
  ): Promise<Result<AcceptOutcome, BusinessError>> {
    const merchantId = invitation.merchantId;
    const [existingAccount] = await trx
      .select({ id: tables.account.id })
      .from(tables.account)
      .where(eq(tables.account.externalId, this.claims.sub))
      .limit(1);

    if (existingAccount) {
      return err({
        code: codes.conflictError,
        message: "This login already belongs to a business. Sign in with a different email to accept the invitation.",
        details: [],
      });
    }

    const accountId = generateId({ model: "account" });
    await trx
      .insert(tables.account)
      .values({ id: accountId, externalId: this.claims.sub, email: invitation.email, merchantId })
      .onDuplicateKeyUpdate({ set: { externalId: sql`${tables.account.externalId}` } });

    const [account] = await trx
      .select({ id: tables.account.id })
      .from(tables.account)
      .where(eq(tables.account.externalId, this.claims.sub))
      .limit(1);

    if (!account) {
      return err({
        code: codes.conflictError,
        message: "The email already belongs to an account in this business.",
        details: [],
      });
    }

    if (account.id !== accountId) {
      return err({ code: codes.conflictError, message: "This login already belongs to a business.", details: [] });
    }

    const acceptedAt = now();
    await trx
      .update(tables.employee)
      .set({ accountId, updatedAt: acceptedAt })
      .where(and(eq(tables.employee.merchantId, merchantId), eq(tables.employee.id, employee.id)));
    await trx
      .update(tables.employeeInvitation)
      .set({ status: "accepted", acceptedAt, updatedAt: acceptedAt })
      .where(eq(tables.employeeInvitation.id, invitation.id));

    const linkedEmployee = await assertFound(this.employeeFinder.find(trx, { merchantId, id: employee.id }));
    return ok({ employee: linkedEmployee, merchantId, accepted: true });
  }

  private async replayAcceptance(
    trx: Database,
    employee: StoredEmployee,
  ): Promise<Result<AcceptOutcome, BusinessError>> {
    const [account] = employee.accountId
      ? await trx
          .select({ externalId: tables.account.externalId })
          .from(tables.account)
          .where(and(eq(tables.account.merchantId, employee.merchantId), eq(tables.account.id, employee.accountId)))
          .limit(1)
      : [];

    if (account?.externalId !== this.claims.sub) {
      return err({ code: codes.conflictError, message: "The invitation has already been used.", details: [] });
    }

    const linkedEmployee = await assertFound(
      this.employeeFinder.find(trx, { merchantId: employee.merchantId, id: employee.id }),
    );
    return ok({ employee: linkedEmployee, merchantId: employee.merchantId, accepted: false });
  }
}

export { AcceptInvitationService };
