import { createMiddleware } from "hono/factory";
import type { InjectedDependencies } from "../app.ts";
import type { FacilitoEnv } from "../types.ts";

function inject(dependencies: InjectedDependencies) {
  return createMiddleware<FacilitoEnv>((ctx, next) => {
    for (const [key, instance] of Object.entries(dependencies)) {
      ctx.set(key as keyof InjectedDependencies, instance);
    }

    return next();
  });
}

export { inject };
