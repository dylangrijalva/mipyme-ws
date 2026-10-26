import { createMiddleware } from "hono/factory";
import type { MipymeEnv } from "../types.ts";
import { camelCaseKeys } from "../utils/camel-case-keys.ts";

function camelCase() {
  return createMiddleware<MipymeEnv>(async (ctx, next) => {
    if (ctx.req.method === "GET") {
      const queryOf = ctx.req.query.bind(ctx.req) as typeof ctx.req.query;
      const queriesOf = ctx.req.queries.bind(ctx.req) as typeof ctx.req.queries;

      ctx.req.query = ((key?: string) => {
        const query = camelCaseKeys(queryOf());
        return key === undefined ? query : query[key];
      }) as typeof ctx.req.query;

      ctx.req.queries = ((key?: string) => {
        const queries = camelCaseKeys(queriesOf());
        return key === undefined ? queries : queries[key];
      }) as typeof ctx.req.queries;
    }

    const contentType = ctx.req.header("Content-Type")?.split(";")[0].trim().toLowerCase();
    const hasJSONBody = contentType === "application/json";

    if (["POST", "PUT", "PATCH", "DELETE"].includes(ctx.req.method) && hasJSONBody) {
      const data = await ctx.req.raw.clone().json();
      ctx.req.json = async <TData = unknown>() => camelCaseKeys(data) as TData;
    }

    return next();
  });
}

export { camelCase };
