type PaginationResponse<T> = {
  results: Array<T>;
  nextCursor: string | null;
  hasMore: boolean;
};

export { type PaginationResponse };
