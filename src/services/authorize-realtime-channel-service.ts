import type { Logger } from "pino";
import type Pusher from "pusher";
import { codes, type BusinessError } from "../contracts/business-error.ts";
import type { CurrentUser } from "../contracts/current-user.ts";
import type { AuthorizeChannelRequest, RealtimeEventPublisher } from "../integrations/realtime-event-publisher.ts";
import { err, ok, type Result } from "../utils/result.ts";
import { BaseService } from "./base-service.ts";

type InjectedDependencies = {
  logger: Logger;
  publisher: RealtimeEventPublisher;
  user: CurrentUser;
};

class AuthorizeRealtimeChannelService extends BaseService<AuthorizeChannelRequest, Pusher.ChannelAuthResponse> {
  private readonly publisher: RealtimeEventPublisher;
  private readonly user: CurrentUser;

  constructor(logger: Logger, publisher: RealtimeEventPublisher, user: CurrentUser) {
    super(logger);
    this.publisher = publisher;
    this.user = user;
  }

  static create({ logger, publisher, user }: InjectedDependencies): AuthorizeRealtimeChannelService {
    return new AuthorizeRealtimeChannelService(logger, publisher, user);
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
