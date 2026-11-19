import z from "zod";

const ID_LENGTH = 24 as const;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" as const;

const ID_PREFIXES = {
  merchant: "merch",
  account: "account",
  request: "req",
  employee: "empl",
  employeeInvitation: "invt",
  location: "loc",
  locationAccess: "loca",
  collection: "coll",
  product: "prod",
  img: "img",
  variant: "var",
  optionGroup: "optgr",
  option: "opt",
  productOptionGroup: "prod_opt",
  productVariantOption: "var_opt",
  inventoryLevel: "inv",
  inventoryMovement: "invm",
  inventoryPhysicalCount: "inv_pct",
  customer: "cust",
  sale: "sale",
  saleItem: "sal_ite",
  salePayment: "sal_pay",
  supplier: "supp",
  purchaseOrder: "purc",
  purchaseOrderItem: "purc_ite",
  supplierProduct: "supp_prod",
  event: "evt",
} as const;

const OBJECT_ID_REGEX = new RegExp(
  `^(?=.{${ID_LENGTH}}$)(?:(?:${Object.values(ID_PREFIXES).join("|")})_)?[${ALPHABET}]+$`,
);

const ObjectId = z
  .string()
  .regex(OBJECT_ID_REGEX, "The resource ID is invalid. Use the complete ID returned by the API.");

export { ALPHABET, ID_LENGTH, ID_PREFIXES, OBJECT_ID_REGEX, ObjectId };
