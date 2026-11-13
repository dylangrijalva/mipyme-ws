import { contextStorage } from "hono/context-storage";
import { describe, expect, it } from "vitest";
import { MipymeHono } from "../../src/types.ts";
import { err, ok } from "../../src/utils/result.ts";
import { toHttpResponse } from "../../src/utils/to-http-response.ts";

const REQUEST_ID = "req_going_merry_000002";

function createApp(respond: () => Response) {
  const app = new MipymeHono();
  app.use(contextStorage());
  app.get("/", (ctx) => {
    ctx.set("requestId", REQUEST_ID);
    ctx.header("Cache-Control", "no-store");
    return respond();
  });
  return app;
}

describe("toHttpResponse", () => {
  it("keeps headers set on the context for a JSON success response", async () => {
    const app = createApp(() => toHttpResponse(ok({ captain: "Monkey D. Luffy" })));

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(await response.json()).toStrictEqual({ captain: "Monkey D. Luffy" });
  });

  it.each([204, 205] as const)("keeps headers set on the context for an empty %i response", async (status) => {
    const app = createApp(() => toHttpResponse(ok(null), status));

    const response = await app.request("/");

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.body).toBeNull();
  });

  it("keeps headers set on the context for an error response", async () => {
    const app = createApp(() =>
      toHttpResponse(err({ code: "resource_not_found", message: "The crew member was not found.", details: [] })),
    );

    const response = await app.request("/");

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(await response.json()).toStrictEqual({
      requestId: REQUEST_ID,
      status: 404,
      code: "resource_not_found",
      message: "The crew member was not found.",
      details: [],
    });
  });
});
