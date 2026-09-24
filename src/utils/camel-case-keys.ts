import camelcase from "camelcase";
import emojiRegex from "emoji-regex";

function isEmojiKey(input: string): boolean {
  const regex = emojiRegex();
  const match = input.match(regex);
  return match !== null && match.join("") === input;
}

function customCamelCase(input: string): string {
  // If the value is a solitary emoji string, return the key as-is
  if (isEmojiKey(input)) {
    return input;
  }

  return camelcase(input);
}

function camelCaseKeys<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => camelCaseKeys(item)) as T;
  }

  if (typeof obj === "object" && obj.constructor === Object) {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = customCamelCase(key);
      converted[camelKey] = camelCaseKeys(value);
    }

    return converted as T;
  }

  return obj;
}

export { camelCaseKeys };
