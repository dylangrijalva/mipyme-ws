import { vi } from "vitest";
import type { Database } from "../../src/db/index.ts";
import type { BroadcastEventParams } from "../../src/integrations/realtime-event-publisher.ts";

function createBroadcastMock() {
  return vi.fn<(params: BroadcastEventParams) => Promise<void>>().mockImplementation(() => new Promise<void>(() => {}));
}

function trackCommittedBroadcasts(db: Database, broadcast: ReturnType<typeof createBroadcastMock>) {
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

export { createBroadcastMock, trackCommittedBroadcasts };
