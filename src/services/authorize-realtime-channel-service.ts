import type { Logger } from "pino";
import type Pusher from "pusher";
import { codes, type BusinessError } from "../contracts/business-error.ts";
import type { CurrentUser } from "../contracts/current-user.ts";
import type { AuthorizeChannelRequest, RealtimeEventPublisher } from "../integrations/realtime-event-publisher.ts";
import { err, ok, type Result } from "../utils/result.ts";
import { BaseService } from "./base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  user: CurrentUser;
  publisher: RealtimeEventPublisher;
};

class AuthorizeRealtimeChannelService extends BaseService<AuthorizeChannelRequest, Pusher.ChannelAuthResponse> {
  private readonly user: CurrentUser;
  private readonly publisher: RealtimeEventPublisher;

  constructor(logger: Logger, user: CurrentUser, publisher: RealtimeEventPublisher) {
    super(logger);
    this.user = user;
    this.publisher = publisher;
  }

  static create(dependencies: InjectedDependencies): AuthorizeRealtimeChannelService {
    return new AuthorizeRealtimeChannelService(dependencies.logger, dependencies.user, dependencies.publisher);
  }

  async execute(request: AuthorizeChannelRequest): Promise<Result<Pusher.ChannelAuthResponse, BusinessError>> {
    const channel = `private-${this.user.merchantId}`;
    if (request.channelName !== channel) {
      return err({
        code: codes.forbiddenError,
        message: "You can only subscribe to your business's realtime channel.",
        details: [],
      });
    }

    return ok(this.publisher.authorizeChannelSubscription(request));
  }
}

export { AuthorizeRealtimeChannelService };
