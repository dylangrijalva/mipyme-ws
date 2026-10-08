function hasDefinedValues(object: object): boolean {
  // We don't check for null values because they are considered values that might be intentionally set to null.
  return Object.values(object).some((value) => value !== undefined);
}

export { hasDefinedValues };
