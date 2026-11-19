import z from "zod";

const StockStatus = z.union([
  z.literal("in_stock"),
  z.literal("low_stock"),
  z.literal("out_of_stock"),
  z.literal("not_stocked"),
]);

type StockStatus = z.infer<typeof StockStatus>;

type StockStatusInput = {
  onHand: number;
  lowStockThreshold: number;
  lastRestockAt: Date | null;
};

const getStockStatus = ({ onHand, lowStockThreshold, lastRestockAt }: StockStatusInput): StockStatus => {
  if (onHand === 0 && lastRestockAt === null) {
    return "not_stocked";
  }

  if (onHand === 0) {
    return "out_of_stock";
  }

  if (lowStockThreshold > 0 && onHand <= lowStockThreshold) {
    return "low_stock";
  }

  return "in_stock";
};

export { getStockStatus, StockStatus };
