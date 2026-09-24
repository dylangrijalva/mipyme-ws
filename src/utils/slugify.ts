function slugify(text: string): string {
  const SPACE_REPLACER = "-" as const;
  const multipleSequentialReplacerRegex = new RegExp(`([${SPACE_REPLACER}]){2,}`, "g");
  const leadingOrTrailingReplacerRegex = new RegExp(`^${SPACE_REPLACER}+|${SPACE_REPLACER}+$`, "g");

  return (text || "")
    .normalize("NFD")
    .replace(/[\u00df]/g, "ss")
    .replace(/[\u1e9e]/g, "SS")
    .replace(/[\u0308]/g, "e")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[!"£$%^&*()+[\]{};:@#~?\\/,|><`¬'=‘’©®™]/g, "")
    .replace(/\s+/g, SPACE_REPLACER)
    .replace(multipleSequentialReplacerRegex, SPACE_REPLACER)
    .replace(leadingOrTrailingReplacerRegex, "");
}

export { slugify };
