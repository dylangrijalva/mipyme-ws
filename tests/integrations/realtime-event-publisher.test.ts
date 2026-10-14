import pino from "pino";
import Pusher from "pusher";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ID_LENGTH } from "../../src/contracts/object-id.ts";
import { Customer } from "../../src/contracts/customer.ts";
import type { Environment } from "../../src/infra/config.env.ts";
import { RealtimeEventPublisher } from "../../src/integrations/realtime-event-publisher.ts";

import { createRealtimeEnv } from "../test-utils/realtime-env.ts";

function setup(environment: Environment = "production") {
  const env = createRealtimeEnv(environment);
  const logError = vi.fn<(message: string) => void>();
  const logger = pino({ level: "error" }, { write: logError });
  const trigger = vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue({ status: 200 } as Pusher.Response);
  const publisher = new RealtimeEventPublisher({ env, logger });
  const snapshot = Customer.parse({
    id: "customer_robin",
    name: "Nico Robin",
    email: null,
    phone: null,
    createdAt: "2026-10-13T12:00:00Z",
    updatedAt: "2026-10-13T12:00:00Z",
  });
  return { publisher, trigger, logError, snapshot };
}

afterEach(() => vi.restoreAllMocks());

describe("RealtimeEventPublisher", () => {
  it.each(["staging", "production"] as const)(
    "publishes a public snapshot to the merchant channel in %s",
    async (environment) => {
      const { publisher, trigger, snapshot } = setup(environment);

      await publisher.broadcast({ merchantId: "merchant_strawhatpirates", resource: { type: "customer", snapshot } });

      expect(trigger).toHaveBeenCalledTimes(1);
      expect(trigger).toHaveBeenCalledWith("private-merchant_strawhatpirates", "facilito.changes", {
        id: expect.stringMatching(/^evt_/),
        resource_id: "customer_robin",
        type: "customer",
        snapshot: {
          id: "customer_robin",
          name: "Nico Robin",
          email: null,
          phone: null,
          created_at: new Date("2026-10-13T12:00:00Z"),
          updated_at: new Date("2026-10-13T12:00:00Z"),
        },
      });
    },
  );

  it.each(["development", "test"] as const)("skips publishing in %s", async (environment) => {
    const { publisher, trigger, snapshot } = setup(environment);

    await publisher.broadcast({ merchantId: "merchant_strawhatpirates", resource: { type: "customer", snapshot } });

    expect(trigger).not.toHaveBeenCalled();
  });

  it.each([
    { size: 10 * 1024 - 1, keepsSnapshot: true },
    { size: 10 * 1024, keepsSnapshot: false },
  ])("sends a $size-byte event with keepsSnapshot=$keepsSnapshot", async ({ size, keepsSnapshot }) => {
    const { publisher, trigger, snapshot } = setup();
    const envelope = {
      id: "evt_" + "X".repeat(ID_LENGTH - 4),
      resource_id: snapshot.id,
      type: "customer",
      snapshot: {
        id: snapshot.id,
        name: "",
        email: null,
        phone: null,
        created_at: snapshot.createdAt,
        updated_at: snapshot.updatedAt,
      },
    };
    const nameBytes = size - Buffer.byteLength(JSON.stringify(envelope), "utf8");
    const name = "船".repeat(Math.floor(nameBytes / 3)) + "x".repeat(nameBytes % 3);

    await publisher.broadcast({
      merchantId: "merchant_strawhatpirates",
      resource: { type: "customer", snapshot: { ...snapshot, name } },
    });

    const payload = trigger.mock.calls[0][2];
    expect(payload).toMatchObject({ resource_id: "customer_robin", type: "customer" });
    expect(payload.snapshot).toEqual(keepsSnapshot ? expect.objectContaining({ name }) : null);
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThan(10 * 1024);
  });

  it("logs a transport failure without rejecting the publishing attempt", async () => {
    const { publisher, trigger, logError, snapshot } = setup();
    const error = new Error("Pusher unavailable");
    trigger.mockRejectedValueOnce(error);

    await expect(
      publisher.broadcast({ merchantId: "merchant_strawhatpirates", resource: { type: "customer", snapshot } }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logError.mock.calls[0][0])).toMatchObject({
      err: { message: "Pusher unavailable" },
      resourceId: "customer_robin",
      resourceType: "customer",
    });
  });
});
