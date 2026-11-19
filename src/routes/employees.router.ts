import { validator } from "hono/validator";
import { ObjectId } from "../contracts/object-id.ts";
import { membershipGuard } from "../guards/membership-guard.ts";
import { authorize } from "../middlewares/authorize.ts";
import { idempotency } from "../middlewares/idempotency.ts";
import { createAuthScopedKey, DEFAULT_RATE_LIMIT_CONFIG, rateLimiter } from "../middlewares/rate-limiter.ts";
import {
  CreateEmployeeInvitationRequest,
  CreateEmployeeInvitationService,
} from "../services/staff/employees/create-employee-invitation-service.ts";
import { CreateEmployeeRequest, CreateEmployeeService } from "../services/staff/employees/create-employee-service.ts";
import { FindEmployeeService } from "../services/staff/employees/find-employee-service.ts";
import { EmployeePaginationRequest, ListEmployeesService } from "../services/staff/employees/list-employees-service.ts";
import { RevokeEmployeeInvitationService } from "../services/staff/employees/revoke-employee-invitation-service.ts";
import { UpdateEmployeeRequest, UpdateEmployeeService } from "../services/staff/employees/update-employee-service.ts";
import { MipymeHono } from "../types.ts";
import { toHttpResponse } from "../utils/to-http-response.ts";

function employeesRouter(): MipymeHono {
  const router = new MipymeHono();

  router.use(authorize(), rateLimiter({ key: createAuthScopedKey, ...DEFAULT_RATE_LIMIT_CONFIG }), membershipGuard());

  router.post(
    "/",
    validator("json", (input) => CreateEmployeeRequest.parse(input)),
    idempotency(),
    async (ctx) => {
      const request = ctx.req.valid("json");
      const service = CreateEmployeeService.create(ctx.var);
      const result = await service.execute(request);
      return toHttpResponse(result, 201);
    },
  );

  router.patch(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    validator("json", (input) => UpdateEmployeeRequest.parse(input)),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const request = ctx.req.valid("json");
      const service = UpdateEmployeeService.create(ctx.var);
      const result = await service.execute([id, request]);
      return toHttpResponse(result);
    },
  );

  router.post(
    "/:id/invitations",
    validator("param", (input) => ObjectId.parse(input.id)),
    validator("json", (input) => CreateEmployeeInvitationRequest.parse(input)),
    idempotency(),
    async (ctx) => {
      const id = ctx.req.valid("param");
      const request = ctx.req.valid("json");
      const service = CreateEmployeeInvitationService.create(ctx.var);
      const result = await service.execute([id, request]);
      return toHttpResponse(result, 201);
    },
  );

  router.post(
    "/:id/invitations/:invitation_id/revoke",
    validator("param", (input) => ({
      employeeId: ObjectId.parse(input.id),
      invitationId: ObjectId.parse(input.invitation_id),
    })),
    async (ctx) => {
      const service = RevokeEmployeeInvitationService.create(ctx.var);
      const result = await service.execute(ctx.req.valid("param"));
      return toHttpResponse(result);
    },
  );

  router.get(
    "/:id",
    validator("param", (input) => ObjectId.parse(input.id)),
    async (ctx) => {
      const service = FindEmployeeService.create(ctx.var);
      const result = await service.execute(ctx.req.valid("param"));
      return toHttpResponse(result);
    },
  );

  router.get(
    "/",
    validator("query", (input) => EmployeePaginationRequest.parse(input)),
    async (ctx) => {
      const service = ListEmployeesService.create(ctx.var);
      const result = await service.execute(ctx.req.valid("query"));
      return toHttpResponse(result);
    },
  );

  return router;
}

export { employeesRouter };
