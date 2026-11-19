import { DrizzleQueryError } from "drizzle-orm";
import { codes } from "../../../contracts/business-error.ts";
import { err } from "../../../utils/result.ts";

function handleCollectionWriteError(error: unknown) {
  const cause = error instanceof DrizzleQueryError ? error.cause : undefined;
  if (
    cause &&
    "code" in cause &&
    cause.code === "ER_DUP_ENTRY" &&
    cause.message.endsWith("'collections.collections_merchant_id_slug_unique'")
  ) {
    return err({
      code: codes.collectionNameAlreadyExists,
      message: "A collection with this name already exists. Choose another name.",
      details: [],
    });
  }

  throw error;
}

export { handleCollectionWriteError };
