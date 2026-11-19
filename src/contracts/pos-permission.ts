import z from "zod";

const PosPermission = z.union([
  z.literal("checkout"),
  z.literal("view_sales_reports"),
  z.literal("view_inventory_reports"),
  z.literal("view_transactions"),
  z.literal("manage_catalog"),
  z.literal("manage_inventory"),
  z.literal("manage_suppliers"),
  z.literal("apply_discounts"),
  z.literal("void_transaction"),
  z.literal("refund"),
  z.literal("manage_employees"),
]);

type PosPermission = z.infer<typeof PosPermission>;

export { PosPermission };
