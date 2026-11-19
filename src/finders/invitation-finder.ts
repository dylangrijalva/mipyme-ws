import { and, asc, eq, gt, lte } from "drizzle-orm";
import { EmployeeInvitation, ReceivedInvitation } from "../contracts/employee-invitation.ts";
import type { InvitationStatus } from "../contracts/invitation-status.ts";
import type { Database } from "../db/index.ts";
import { tables } from "../db/schema.ts";
import { normalizeEmail } from "../utils/normalize-email.ts";
import { now } from "../utils/now.ts";
import { resolveInvitationStatus } from "../utils/resolve-invitation-status.ts";

type Criteria = {
  merchantId?: string;
  employeeId?: string;
  id?: string;
  email?: string;
  status?: InvitationStatus;
};

class InvitationFinder {
  async find(db: Database, criteria: Criteria): Promise<EmployeeInvitation | null> {
    const [record] = await db.select().from(tables.employeeInvitation).where(this.where(criteria)).limit(1);
    return record ? EmployeeInvitation.parse({ ...record, status: resolveInvitationStatus(record) }) : null;
  }

  async findReceived(db: Database, criteria: Criteria): Promise<Array<ReceivedInvitation>> {
    const records = await db
      .select({
        invitation: tables.employeeInvitation,
        merchant: { id: tables.merchant.id, name: tables.merchant.name },
        employee: { id: tables.employee.id, name: tables.employee.name },
      })
      .from(tables.employeeInvitation)
      .innerJoin(tables.merchant, eq(tables.merchant.id, tables.employeeInvitation.merchantId))
      .innerJoin(
        tables.employee,
        and(
          eq(tables.employee.id, tables.employeeInvitation.employeeId),
          eq(tables.employee.merchantId, tables.employeeInvitation.merchantId),
        ),
      )
      .where(this.where(criteria))
      .orderBy(asc(tables.employeeInvitation.createdAt), asc(tables.employeeInvitation.id));

    return records.map((record) =>
      ReceivedInvitation.parse({
        ...record.invitation,
        status: resolveInvitationStatus(record.invitation),
        merchant: record.merchant,
        employee: record.employee,
      }),
    );
  }

  private where(criteria: Criteria) {
    return and(
      criteria.merchantId !== undefined ? eq(tables.employeeInvitation.merchantId, criteria.merchantId) : undefined,
      criteria.employeeId !== undefined ? eq(tables.employeeInvitation.employeeId, criteria.employeeId) : undefined,
      criteria.id !== undefined ? eq(tables.employeeInvitation.id, criteria.id) : undefined,
      criteria.email !== undefined ? eq(tables.employeeInvitation.email, normalizeEmail(criteria.email)) : undefined,
      criteria.status !== undefined ? this.status(criteria.status) : undefined,
    );
  }

  private status(status: InvitationStatus) {
    if (status === "invited") {
      return and(eq(tables.employeeInvitation.status, "invited"), gt(tables.employeeInvitation.expiresAt, now()));
    }

    if (status === "expired") {
      return and(eq(tables.employeeInvitation.status, "invited"), lte(tables.employeeInvitation.expiresAt, now()));
    }

    return eq(tables.employeeInvitation.status, status);
  }
}

export { InvitationFinder };
