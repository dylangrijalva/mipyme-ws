import type { Redis } from "ioredis";
import { createHash, createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import z from "zod";
import { codes, type BusinessError } from "../../contracts/business-error.ts";
import { SYNC_UNAVAILABLE } from "../../contracts/sync.ts";
import { err, ok, type Result } from "../../utils/result.ts";

const TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const TokenPayload = z.object({
  version: z.literal(1),
  merchantId: z.string(),
  checkpoint: z.string().regex(/^[a-f0-9]{64}$/),
  nonce: z.uuid(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});

const INVALID_TOKEN: BusinessError = {
  code: codes.syncTokenInvalid,
  message: "The sync token is invalid for this business. Start a full sync with sync_token set to '*'.",
  details: [],
};

async function parseJson(value: string): Promise<unknown> {
  return Promise.resolve()
    .then((): unknown => JSON.parse(value))
    .catch(() => undefined);
}

class SyncTokenStore {
  private readonly signingKey: Uint8Array;

  constructor(
    private readonly cache: Redis,
    secret: string,
  ) {
    // Derive a separate signing key so sync tokens cannot be used as authentication tokens.
    this.signingKey = new Uint8Array(hkdfSync("sha256", secret, "facilito", "sync-token-v1", 32));
  }

  async load(token: string, merchantId: string): Promise<Result<Date | null, BusinessError>> {
    if (token === "*") {
      return ok(null);
    }

    const parts = token.split(".");
    const [payload, signature] = parts;
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
      return err(INVALID_TOKEN);
    }
    const expected = this.sign(payload);
    if (!timingSafeEqual(Uint8Array.from(Buffer.from(signature)), Uint8Array.from(Buffer.from(expected)))) {
      return err(INVALID_TOKEN);
    }

    const decoded = TokenPayload.safeParse(await parseJson(Buffer.from(payload, "base64url").toString("utf8")));
    if (!decoded.success || decoded.data.merchantId !== merchantId) {
      return err(INVALID_TOKEN);
    }
    if (decoded.data.expiresAt <= Math.floor(Date.now() / 1000)) {
      return ok(null);
    }

    const checkpoint = await this.cache.get(this.key(merchantId, decoded.data.checkpoint)).then(
      (value) => ok(value),
      () => err(SYNC_UNAVAILABLE),
    );
    if (!checkpoint.success) {
      return checkpoint;
    }
    if (checkpoint.value === null) {
      return ok(null);
    }

    const parsed = z.iso.datetime().safeParse(checkpoint.value);
    const digest = createHash("sha256").update(checkpoint.value).digest("hex");
    if (!parsed.success || digest !== decoded.data.checkpoint) {
      return err(SYNC_UNAVAILABLE);
    }
    return ok(new Date(parsed.data));
  }

  async save(syncedAt: Date, merchantId: string): Promise<Result<string, BusinessError>> {
    const serialized = syncedAt.toISOString();
    const digest = createHash("sha256").update(serialized).digest("hex");
    const saved = await this.cache.set(this.key(merchantId, digest), serialized, "EX", TOKEN_LIFETIME_SECONDS).then(
      (value) => value === "OK",
      () => false,
    );
    if (!saved) {
      return err(SYNC_UNAVAILABLE);
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        merchantId,
        checkpoint: digest,
        nonce: randomUUID(),
        issuedAt,
        expiresAt: issuedAt + TOKEN_LIFETIME_SECONDS,
      }),
    ).toString("base64url");
    return ok(`${payload}.${this.sign(payload)}`);
  }

  private key(merchantId: string, digest: string): string {
    // Signed expiry bounds each token even when timestamps share a Redis entry.
    return `sync:v1:${merchantId}:${digest}`;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.signingKey).update(payload).digest("base64url");
  }
}

export { SyncTokenStore };
