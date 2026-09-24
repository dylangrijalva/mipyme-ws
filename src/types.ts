import { Hono } from "hono";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Database } from "./db/index.ts";
import type { EnvVars } from "./infra/config.env.ts";

type FacilitoEnv = {
  Variables: {
    requestId: string;
    logger: Logger;
    env: EnvVars;
    db: Database;
    cache: Redis;
  };
};

class FacilitoHono extends Hono<FacilitoEnv> {}

export { FacilitoHono, type FacilitoEnv };
