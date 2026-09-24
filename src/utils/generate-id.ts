import { customAlphabet } from "nanoid";
import { ALPHABET, ID_LENGTH, ID_PREFIXES } from "../contracts/object-id.ts";

const factory = customAlphabet(ALPHABET, ID_LENGTH);

function generateId<TModel extends keyof typeof ID_PREFIXES>(
  params: { model?: TModel; length?: number } = {
    model: undefined,
    length: ID_LENGTH,
  },
): string {
  const { model, length } = params;
  const totalLength = length ?? ID_LENGTH;
  if (!Number.isSafeInteger(totalLength) || totalLength < 1) {
    throw new RangeError("ID length must be a positive safe integer.");
  }

  if (!model) {
    return factory(totalLength);
  }

  const prefix = ID_PREFIXES[model];
  const idLength = totalLength - prefix.length - 1;
  if (idLength < 1) {
    throw new RangeError("ID length must leave room for at least one random character after the prefix.");
  }
  const id = factory(idLength);
  return `${prefix}_${id}`;
}

export { generateId };
