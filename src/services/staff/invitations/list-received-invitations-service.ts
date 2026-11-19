import type { Logger } from "pino";
import type { BusinessError } from "../../../contracts/business-error.ts";
import type { ReceivedInvitation } from "../../../contracts/employee-invitation.ts";
import type { JsonWebTokenPayload } from "../../../contracts/json-web-token-payload.ts";
import type { PaginationResponse } from "../../../contracts/pagination-response.ts";
import type { Database } from "../../../db/index.ts";
import type { InvitationFinder } from "../../../finders/invitation-finder.ts";
import { ok, type Result } from "../../../utils/result.ts";
import { BaseService } from "../../base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  db: Database;
  invitationFinder: InvitationFinder;
  claims: JsonWebTokenPayload;
};

class ListReceivedInvitationsService extends BaseService<void, PaginationResponse<ReceivedInvitation>> {
  private readonly db: Database;
  private readonly invitationFinder: InvitationFinder;
  private readonly claims: JsonWebTokenPayload;

  constructor(logger: Logger, db: Database, invitationFinder: InvitationFinder, claims: JsonWebTokenPayload) {
    super(logger);
    this.db = db;
    this.invitationFinder = invitationFinder;
    this.claims = claims;
  }

  static create({ logger, db, invitationFinder, claims }: InjectedDependencies): ListReceivedInvitationsService {
    return new ListReceivedInvitationsService(logger, db, invitationFinder, claims);
  }

  async execute(): Promise<Result<PaginationResponse<ReceivedInvitation>, BusinessError>> {
    const invitations = await this.invitationFinder.findReceived(this.db, {
      email: this.claims.email,
      status: "invited",
    });
    return ok({ results: invitations, nextCursor: null, hasMore: false });
  }
}

export { ListReceivedInvitationsService };
