function hasDefinedValues(object: object): boolean {
  return Object.values(object).some((value) => value !== undefined);
}

export { hasDefinedValues };
