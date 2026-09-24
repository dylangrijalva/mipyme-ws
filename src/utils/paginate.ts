import type { PaginationResponse } from "../contracts/pagination-response.ts";

type ItemWithId = {
  id: string;
};

type PaginateParams<T extends ItemWithId> = {
  collection: Array<T>;
  limit: number;
};

function paginate<TItem extends ItemWithId>(params: PaginateParams<TItem>): PaginationResponse<TItem> {
  const { collection, limit } = params;
  const hasMore = collection.length > limit;
  const results = hasMore ? collection.slice(0, limit) : collection;
  const nextCursor = hasMore ? collection[limit - 1].id : null;
  return { results, nextCursor, hasMore };
}

export { paginate };
