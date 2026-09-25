import { Hono } from "hono";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { JsonWebTokenPayload } from "./contracts/json-web-token-payload.ts";
import type { Database } from "./db/index.ts";
import type { MerchantFinder } from "./finders/merchant-repository.ts";
import type { EnvVars } from "./infra/config.env.ts";
import type { IdentityProvider } from "./integrations/identity-provider.ts";

type FacilitoEnv = {
  Variables: {
    requestId: string;
    logger: Logger;
    env: EnvVars;
    db: Database;
    cache: Redis;
    identity: IdentityProvider;
    merchantFinder: MerchantFinder;
    claims: JsonWebTokenPayload;
  };
};

class FacilitoHono extends Hono<FacilitoEnv> {}

export { FacilitoHono, type FacilitoEnv };
