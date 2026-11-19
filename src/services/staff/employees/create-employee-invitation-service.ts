import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import z from "zod";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { EmployeeInvitation } from "../../../contracts/employee-invitation.ts";
import { EMAIL_REGEX } from "../../../contracts/regexs.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { EmployeeFinder } from "../../../finders/employee-finder.ts";
import type { InvitationFinder } from "../../../finders/invitation-finder.ts";
import type { MerchantFinder } from "../../../finders/merchant-finder.ts";
import type { EmailSender } from "../../../integrations/email-sender.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../../utils/assert-found.ts";
import { generateId } from "../../../utils/generate-id.ts";
import { normalizeEmail } from "../../../utils/normalize-email.ts";
import { now } from "../../../utils/now.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";
import type { AuthorizedEmployee } from "../../employee-authorization-service.ts";
import type { EmployeeManagement } from "./employee-management.ts";

const INVITATION_VALIDITY_IN_DAYS = 7 as const;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const CreateEmployeeInvitationRequest = z.object({
  email: z
    .string()
    .trim()
    .max(320)
    .regex(EMAIL_REGEX, "Provide a valid email address, such as nami@example.com.")
    .transform(normalizeEmail),
});

type CreateEmployeeInvitationRequest = z.infer<typeof CreateEmployeeInvitationRequest>;

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  emailSender: EmailSender;
  employeeFinder: EmployeeFinder;
  invitationFinder: InvitationFinder;
  merchantFinder: MerchantFinder;
  user: CurrentUser;
  employeeManagement: EmployeeManagement;
};

class CreateEmployeeInvitationService extends BaseService<
  [string, CreateEmployeeInvitationRequest],
  EmployeeInvitation
> {
  private readonly db: Database;
  private readonly employeeManagement: EmployeeManagement;
  private readonly publisher: RealtimeEventPublisher;
  private readonly emailSender: EmailSender;
  private readonly employeeFinder: EmployeeFinder;
  private readonly invitationFinder: InvitationFinder;
  private readonly merchantFinder: MerchantFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    publisher: RealtimeEventPublisher,
    emailSender: EmailSender,
    employeeFinder: EmployeeFinder,
    invitationFinder: InvitationFinder,
    merchantFinder: MerchantFinder,
    user: CurrentUser,
    employeeManagement: EmployeeManagement,
  ) {
    super(logger);
    this.db = db;
    this.employeeManagement = employeeManagement;
    this.publisher = publisher;
    this.emailSender = emailSender;
    this.employeeFinder = employeeFinder;
    this.invitationFinder = invitationFinder;
    this.merchantFinder = merchantFinder;
    this.user = user;
  }

  static create({
    logger,
    db,
    publisher,
    emailSender,
    employeeFinder,
    invitationFinder,
    merchantFinder,
    user,
    employeeManagement,
  }: InjectedDependencies): CreateEmployeeInvitationService {
    return new CreateEmployeeInvitationService(
      logger,
      db,
      publisher,
      emailSender,
      employeeFinder,
      invitationFinder,
      merchantFinder,
      user,
      employeeManagement,
    );
  }

  async execute([employeeId, request]: [string, CreateEmployeeInvitationRequest]): Promise<
    Result<EmployeeInvitation, BusinessError>
  > {
    const authorization = await this.employeeManagement.authorize(this.db, this.user);
    if (!authorization.success) {
      return authorization;
    }

    const inviter = authorization.value;
    const result = await this.db.transaction((trx) => this.invite(trx, inviter, employeeId, request.email));
    if (!result.success) {
      return result;
    }

    const invitation = result.value;
    const merchantId = this.user.merchantId;
    const [employee, merchant] = await Promise.all([
      assertFound(this.employeeFinder.find(this.db, { merchantId, id: employeeId })),
      assertFound(this.merchantFinder.find(this.db, merchantId)),
    ]);

    this.emailSender.sendEmployeeInvitation({
      invitationId: invitation.id,
      to: invitation.email,
      employeeName: employee.name,
      inviterName: inviter.name,
      merchantName: merchant.name,
      country: merchant.country,
      expiresInDays: INVITATION_VALIDITY_IN_DAYS,
    });
    this.publisher.broadcast({ merchantId, resource: { type: "employee", snapshot: employee } });

    return ok(invitation);
  }

  private async invite(
    trx: Database,
    inviter: AuthorizedEmployee,
    employeeId: string,
    email: string,
  ): Promise<Result<EmployeeInvitation, BusinessError>> {
    const merchantId = this.user.merchantId;
    await this.employeeManagement.lockMerchant(trx, merchantId);
    const [employee] = await trx
      .select()
      .from(tables.employee)
      .where(and(eq(tables.employee.merchantId, merchantId), eq(tables.employee.id, employeeId)))
      .for("update");

    if (!employee) {
      return err({ code: codes.resourceNotFound, message: `Employee ${employeeId} has not been found.`, details: [] });
    }

    if (employee.isOwner || employee.accountId) {
      return err({ code: codes.conflictError, message: "The employee already has an account.", details: [] });
    }

    if (employee.status === "archived") {
      return err({ code: codes.conflictError, message: "Archived employees cannot be invited.", details: [] });
    }

    const [account] = await trx
      .select({ id: tables.account.id })
      .from(tables.account)
      .where(and(eq(tables.account.merchantId, merchantId), eq(tables.account.email, email)))
      .limit(1);

    if (account) {
      return err({
        code: codes.conflictError,
        message: "The email already belongs to an account in your business.",
        details: [],
      });
    }

    const invitedAt = now();
    await trx
      .update(tables.employeeInvitation)
      .set({ status: "revoked", revokedAt: invitedAt, updatedAt: invitedAt })
      .where(
        and(
          eq(tables.employeeInvitation.merchantId, merchantId),
          eq(tables.employeeInvitation.employeeId, employeeId),
          eq(tables.employeeInvitation.status, "invited"),
        ),
      );

    const id = generateId({ model: "employeeInvitation" });
    await trx.insert(tables.employeeInvitation).values({
      id,
      email,
      status: "invited",
      expiresAt: new Date(invitedAt.getTime() + INVITATION_VALIDITY_IN_DAYS * DAY_IN_MS),
      employeeId,
      invitedById: inviter.id,
      merchantId,
      createdAt: invitedAt,
      updatedAt: invitedAt,
    });

    await trx
      .update(tables.employee)
      .set({ updatedAt: invitedAt })
      .where(and(eq(tables.employee.merchantId, merchantId), eq(tables.employee.id, employeeId)));

    return ok(await assertFound(this.invitationFinder.find(trx, { merchantId, employeeId, id })));
  }
}

export { CreateEmployeeInvitationRequest, CreateEmployeeInvitationService, INVITATION_VALIDITY_IN_DAYS };
