function splitDistinct(value: string | null | undefined, delimiter: string): Array<string> {
  if (!value) {
    return [];
  }

  return [...new Set(value.split(delimiter).filter(Boolean))];
}

export { splitDistinct };
