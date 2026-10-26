import { createMiddleware } from "hono/factory";
import type { InjectedDependencies } from "../app.ts";
import type { MipymeEnv } from "../types.ts";

function inject(dependencies: InjectedDependencies) {
  return createMiddleware<MipymeEnv>((ctx, next) => {
    for (const [key, instance] of Object.entries(dependencies)) {
      ctx.set(key as keyof InjectedDependencies, instance);
    }

    return next();
  });
}

export { inject };
