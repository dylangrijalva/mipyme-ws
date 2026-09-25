import type { Logger } from "pino";
import type { BusinessError } from "../contracts/business-error.ts";
import type { Result } from "../utils/result.ts";

abstract class BaseService<TRequest, TResponse, TError extends BusinessError = BusinessError> {
  protected readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ _tag: this.constructor.name });
  }

  abstract execute(request: TRequest): Promise<Result<TResponse, TError>>;
}

export { BaseService };
