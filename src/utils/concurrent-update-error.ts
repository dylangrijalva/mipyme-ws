class ConcurrentUpdateError extends Error {}

function isConcurrentUpdateError(error: unknown): error is ConcurrentUpdateError {
  return error instanceof ConcurrentUpdateError;
}

export { ConcurrentUpdateError, isConcurrentUpdateError };
