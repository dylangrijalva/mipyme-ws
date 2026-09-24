function assertFound<T>(promise: Promise<T | undefined | null>): Promise<T> {
  return promise as Promise<T>;
}

export { assertFound };
