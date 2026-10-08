import Big from "big.js";

function lessThan(left: string, right: string): boolean {
  return new Big(left).lt(right);
}

function isPositive(value: string): boolean {
  return new Big(value).gt("0");
}

function subtract(left: string, right: string): string {
  return new Big(left).minus(right).toFixed();
}

function add(left: string, right: string): string {
  return new Big(left).plus(right).toFixed();
}

function multiply(left: string, right: string): string {
  return new Big(left).times(right).toFixed();
}

function divideAndRound(left: string, right: string, decimalPlaces: number): string {
  return new Big(left).div(right).toFixed(decimalPlaces, Big.roundHalfUp);
}

export { add, divideAndRound, isPositive, lessThan, multiply, subtract };
