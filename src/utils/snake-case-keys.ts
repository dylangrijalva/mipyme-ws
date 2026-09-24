function snakeCaseKeys<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => snakeCaseKeys(item)) as T;
  }

  if (typeof obj === "object" && obj.constructor === Object) {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
      converted[snakeKey] = snakeCaseKeys(value);
    }

    return converted as T;
  }

  return obj;
}

export { snakeCaseKeys };
