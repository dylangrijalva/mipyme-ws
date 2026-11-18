import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { buffer } from "node:stream/consumers";

async function startProductImageStorage() {
  // The stand-in accepts invalid PUTs so the workflow can test verifier checks independently of signing.
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "PUT") {
      const body = await buffer(request);
      objects.set(path, { body, contentType: request.headers["content-type"] ?? "" });
      response.writeHead(200).end();
      return;
    }

    const object = objects.get(path);
    if (request.method === "GET" && object) {
      response.writeHead(200, { "content-type": object.contentType, "content-length": object.body.length });
      response.end(object.body);
      return;
    }

    response.writeHead(404, { "content-type": "application/xml" });
    response.end("<Error><Code>NoSuchKey</Code><Message>Object not found</Message></Error>");
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  assert(address && typeof address !== "string");

  return {
    endpoint: new URL("http://127.0.0.1:" + address.port).origin,
    async close() {
      const closed = once(server, "close");
      server.close();
      await closed;
    },
  };
}

export { startProductImageStorage };
