import z from "zod";

const StockStatus = z.union([z.literal("in_stock"), z.literal("low_stock"), z.literal("out_of_stock")]);

type StockStatus = z.infer<typeof StockStatus>;

type StockStatusInput = {
  onHand: number;
  lowStockThreshold: number;
};

const getStockStatus = ({ onHand, lowStockThreshold }: StockStatusInput): StockStatus => {
  if (onHand === 0) {
    return "out_of_stock";
  }

  if (lowStockThreshold > 0 && onHand <= lowStockThreshold) {
    return "low_stock";
  }

  return "in_stock";
};

export { getStockStatus, StockStatus };
