import { and, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { codes, type BusinessError } from "../../../contracts/business-error.ts";
import type { CurrentUser } from "../../../contracts/current-user.ts";
import type { EmployeeInvitation } from "../../../contracts/employee-invitation.ts";
import type { Database } from "../../../db/index.ts";
import { tables } from "../../../db/schema.ts";
import type { EmployeeFinder } from "../../../finders/employee-finder.ts";
import type { InvitationFinder } from "../../../finders/invitation-finder.ts";
import type { RealtimeEventPublisher } from "../../../integrations/realtime-event-publisher.ts";
import { assertFound } from "../../../utils/assert-found.ts";
import { now } from "../../../utils/now.ts";
import { err, ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";
import type { EmployeeManagement } from "../../employee-management.ts";

type RevokeEmployeeInvitationRequest = {
  employeeId: string;
  invitationId: string;
};

type RevokeOutcome = {
  invitation: EmployeeInvitation;
  revoked: boolean;
};

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  publisher: RealtimeEventPublisher;
  employeeFinder: EmployeeFinder;
  invitationFinder: InvitationFinder;
  user: CurrentUser;
  employeeManagement: EmployeeManagement;
};

class RevokeEmployeeInvitationService extends BaseService<RevokeEmployeeInvitationRequest, EmployeeInvitation> {
  private readonly db: Database;
  private readonly employeeManagement: EmployeeManagement;
  private readonly publisher: RealtimeEventPublisher;
  private readonly employeeFinder: EmployeeFinder;
  private readonly invitationFinder: InvitationFinder;
  private readonly user: CurrentUser;

  constructor(
    logger: Logger,
    db: Database,
    publisher: RealtimeEventPublisher,
    employeeFinder: EmployeeFinder,
    invitationFinder: InvitationFinder,
    user: CurrentUser,
    employeeManagement: EmployeeManagement,
  ) {
    super(logger);
    this.db = db;
    this.employeeManagement = employeeManagement;
    this.publisher = publisher;
    this.employeeFinder = employeeFinder;
    this.invitationFinder = invitationFinder;
    this.user = user;
  }

  static create({
    logger,
    db,
    publisher,
    employeeFinder,
    invitationFinder,
    user,
    employeeManagement,
  }: InjectedDependencies): RevokeEmployeeInvitationService {
    return new RevokeEmployeeInvitationService(
      logger,
      db,
      publisher,
      employeeFinder,
      invitationFinder,
      user,
      employeeManagement,
    );
  }

  async execute(request: RevokeEmployeeInvitationRequest): Promise<Result<EmployeeInvitation, BusinessError>> {
    const authorization = await this.employeeManagement.authorize(this.db, this.user);
    if (!authorization.success) {
      return authorization;
    }

    const result = await this.db.transaction((trx) => this.revoke(trx, request));
    if (!result.success) {
      return result;
    }

    const { invitation, revoked } = result.value;
    if (revoked) {
      const merchantId = this.user.merchantId;
      const employee = await assertFound(this.employeeFinder.find(this.db, { merchantId, id: request.employeeId }));
      this.publisher.broadcast({ merchantId, resource: { type: "employee", snapshot: employee } });
    }

    return ok(invitation);
  }

  private async revoke(
    trx: Database,
    request: RevokeEmployeeInvitationRequest,
  ): Promise<Result<RevokeOutcome, BusinessError>> {
    const merchantId = this.user.merchantId;
    await this.employeeManagement.lockMerchant(trx, merchantId);
    const condition = and(
      eq(tables.employeeInvitation.merchantId, merchantId),
      eq(tables.employeeInvitation.employeeId, request.employeeId),
      eq(tables.employeeInvitation.id, request.invitationId),
    );
    const [invitation] = await trx.select().from(tables.employeeInvitation).where(condition).for("update");

    if (!invitation) {
      return err({ code: codes.resourceNotFound, message: "The invitation has not been found.", details: [] });
    }

    if (invitation.status === "accepted") {
      return err({ code: codes.conflictError, message: "An accepted invitation cannot be revoked.", details: [] });
    }

    const criteria = { merchantId, employeeId: request.employeeId, id: request.invitationId };
    if (invitation.status === "revoked") {
      return ok({ invitation: await assertFound(this.invitationFinder.find(trx, criteria)), revoked: false });
    }

    const revokedAt = now();
    await trx
      .update(tables.employeeInvitation)
      .set({ status: "revoked", revokedAt, updatedAt: revokedAt })
      .where(condition);
    await trx
      .update(tables.employee)
      .set({ updatedAt: revokedAt })
      .where(and(eq(tables.employee.merchantId, merchantId), eq(tables.employee.id, request.employeeId)));

    return ok({ invitation: await assertFound(this.invitationFinder.find(trx, criteria)), revoked: true });
  }
}

export { RevokeEmployeeInvitationService, type RevokeEmployeeInvitationRequest };
