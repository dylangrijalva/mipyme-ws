import Big from "big.js";

function timestampMicroseconds(value: string): Big {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? "0";
  return new Big(new Date(value).getTime()).times(1000).plus(new Big(`0.${fraction}`).times(1000000).mod(1000));
}

function databaseTimestamp(value: string, rounding: typeof Big.roundUp | typeof Big.roundDown): string {
  const fraction = value.match(/\.(\d+)/)?.[1] ?? "0";
  const microseconds = new Big(`0.${fraction}`).times(1000000).round(0, rounding);
  const date = new Date(value);
  date.setUTCMilliseconds(0);
  if (microseconds.eq(1000000)) {
    date.setUTCSeconds(date.getUTCSeconds() + 1);
  }
  return `${date.toISOString().slice(0, 19).replace("T", " ")}.${microseconds.mod(1000000).toFixed(0).padStart(6, "0")}`;
}

export { databaseTimestamp, timestampMicroseconds };
