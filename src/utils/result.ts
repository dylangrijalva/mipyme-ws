import type { BusinessError } from "../contracts/business-error.ts";

type Success<T> = {
  success: true;
  value: T;
  error?: never;
};

type Failure<E> = {
  success: false;
  error: E;
  value?: never;
};

type Result<T, E> = Success<T> | Failure<E>;

function ok<T>(value: T): Success<T> {
  return { success: true, value };
}

function err<E extends BusinessError>(error: E): Failure<E> {
  return { success: false, error };
}

export { err, ok, type Failure, type Result, type Success };
