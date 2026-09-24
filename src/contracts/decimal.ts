import Big from "big.js";
import z from "zod";

const DECIMAL_SCALE = 2 as const;
const Regex = new RegExp(`^\\d+(\\.\\d{1,${DECIMAL_SCALE}})?$`);

const Decimal = z
  .string()
  .regex(Regex, `Provide a non-negative decimal as a string with at most ${DECIMAL_SCALE} decimal places.`);

const PositiveDecimal = Decimal.refine(
  (value) => new Big(value).gt(0),
  `Provide a decimal greater than zero as a string with at most ${DECIMAL_SCALE} decimal places.`,
);

export { DECIMAL_SCALE, Decimal, PositiveDecimal };
