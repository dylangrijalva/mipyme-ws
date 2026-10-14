import pino from "pino";
import { vi } from "vitest";
import type { Database } from "../../src/db/index.ts";
import { RealtimeEventPublisher } from "../../src/integrations/realtime-event-publisher.ts";
import { createRealtimeEnv } from "./realtime-env.ts";

function createRealtimeEventPublisherMock() {
  const publisher = new RealtimeEventPublisher({ env: createRealtimeEnv(), logger: pino({ enabled: false }) });
  const broadcast = vi.spyOn(publisher, "broadcast").mockImplementation(() => new Promise<void>(() => {}));

  return { broadcast, publisher };
}

function trackCommittedBroadcasts(
  db: Database,
  broadcast: ReturnType<typeof createRealtimeEventPublisherMock>["broadcast"],
) {
  const transaction = db.transaction.bind(db);
  const committedAtPublish: Array<boolean> = [];
  let transactionCommitted = false;
  vi.spyOn(db, "transaction").mockImplementation(async (...arguments_) => {
    transactionCommitted = false;
    const result = await transaction(...arguments_);
    transactionCommitted = true;
    return result;
  });
  broadcast.mockImplementation(() => {
    committedAtPublish.push(transactionCommitted);
    return new Promise<void>(() => {});
  });
  return committedAtPublish;
}

export { createRealtimeEventPublisherMock, trackCommittedBroadcasts };
