import type { Logger } from "pino";
import Pusher from "pusher";
import z from "zod";
import type { Collection } from "../contracts/collection.ts";
import type { Customer } from "../contracts/customer.ts";
import type { Employee } from "../contracts/employee.ts";
import type { Location } from "../contracts/location.ts";
import type { Merchant } from "../contracts/merchant.ts";
import type { Product } from "../contracts/product.ts";
import type { Purchase } from "../contracts/purchase.ts";
import type { Sale } from "../contracts/sale.ts";
import type { Supplier } from "../contracts/supplier.ts";
import type { EnvVars } from "../infra/config.env.ts";
import { generateId } from "../utils/generate-id.ts";
import { snakeCaseKeys } from "../utils/snake-case-keys.ts";

type InjectedDependencies = {
  env: EnvVars;
  logger: Logger;
};

type ResourceSnapshot =
  | { type: "collection"; snapshot: Collection }
  | { type: "customer"; snapshot: Customer }
  | { type: "employee"; snapshot: Employee }
  | { type: "merchant"; snapshot: Merchant }
  | { type: "sale"; snapshot: Sale }
  | { type: "product"; snapshot: Product }
  | { type: "purchase_order"; snapshot: Purchase }
  | { type: "location"; snapshot: Location }
  | { type: "supplier"; snapshot: Supplier };

type PublishEventParams = {
  merchantId: string;
  resource: ResourceSnapshot;
};

const AuthorizeChannelRequest = z.object({
  socketId: z.string().regex(/^\d+\.\d+$/, "Provide the socket ID returned by Pusher, such as 123.456."),
  channelName: z.string().nonempty(),
});

type AuthorizeChannelRequest = z.infer<typeof AuthorizeChannelRequest>;

class RealtimeEventPublisher {
  private readonly logger: Logger;
  private readonly env: EnvVars;
  private readonly pusher: Pusher;

  constructor({ env, logger }: InjectedDependencies) {
    this.logger = logger.child({ component: this.constructor.name });
    this.env = env;
    this.pusher = new Pusher({
      appId: env.PUSHER_APP_ID,
      key: env.PUSHER_KEY,
      secret: env.PUSHER_SECRET,
      cluster: env.PUSHER_CLUSTER,
      useTLS: true,
    });
  }

  async broadcast({ merchantId, resource }: PublishEventParams): Promise<void> {
    const shouldPublishEvents = this.env.NODE_ENV === "staging" || this.env.NODE_ENV === "production";
    if (!shouldPublishEvents) {
      this.logger.debug(
        { resourceId: resource.snapshot.id, resourceType: resource.type },
        "Event publishing are skipped when running in test mode",
      );

      return;
    }

    try {
      const event = snakeCaseKeys({
        id: generateId({ model: "event" }),
        resourceId: resource.snapshot.id,
        ...resource,
      });
      const CHANGE_EVENT_NAME = "facilito.changes" as const;
      const PUSHER_EVENT_DATA_LIMIT_IN_BYTES = 10 * 1024;
      const serializedEvent = JSON.stringify(event);
      const isOversized = Buffer.byteLength(serializedEvent, "utf8") >= PUSHER_EVENT_DATA_LIMIT_IN_BYTES;
      const payload = isOversized ? { ...event, snapshot: null } : event;
      const channel = `private-${merchantId}`;

      await this.pusher.trigger(channel, CHANGE_EVENT_NAME, payload);
      this.logger.info({ event: payload }, "An event has been emitted successfully");
    } catch (error: unknown) {
      this.logger.error(
        { err: error, resourceId: resource.snapshot.id, resourceType: resource.type },
        "Realtime event publishing failed",
      );
    }
  }

  authorizeChannelSubscription({ socketId, channelName }: AuthorizeChannelRequest): Pusher.ChannelAuthResponse {
    return this.pusher.authorizeChannel(socketId, channelName);
  }
}

export {
  AuthorizeChannelRequest,
  RealtimeEventPublisher,
  type PublishEventParams as BroadcastEventParams,
  type ResourceSnapshot as RealtimeResource,
};
