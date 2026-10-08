import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { codes } from "../contracts/business-error.ts";
import { tables } from "../db/schema.ts";
import type { FacilitoEnv } from "../types.ts";
import { err } from "../utils/result.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function membershipGuard() {
  return createMiddleware<FacilitoEnv>(async (ctx, next) => {
    const { db, claims } = ctx.var;

    const [membership] = await db
      .select({
        id: tables.account.id,
        email: tables.account.email,
        merchantId: tables.account.merchantId,
        employeeId: tables.employee.id,
        isOwner: tables.employee.isOwner,
        status: tables.employee.status,
      })
      .from(tables.account)
      .innerJoin(
        tables.employee,
        and(
          eq(tables.employee.accountId, tables.account.id),
          eq(tables.employee.merchantId, tables.account.merchantId),
        ),
      )
      .where(eq(tables.account.externalId, claims.sub))
      .limit(1);

    if (!membership) {
      return toHttpResponse(
        err({
          code: codes.accountNotProvisioned,
          message: "Complete onboarding before accessing this resource.",
          details: [],
        }),
      );
    }

    if (membership.status !== "enabled") {
      return toHttpResponse(
        err({
          code: codes.forbiddenError,
          message: "Your employee access is not enabled. Contact your business owner.",
          details: [],
        }),
      );
    }

    ctx.set("user", {
      id: membership.id,
      email: membership.email,
      merchantId: membership.merchantId,
      employeeId: membership.employeeId,
      accountType: membership.isOwner ? "owner" : "staff",
    });

    return next();
  });
}

export { membershipGuard };
