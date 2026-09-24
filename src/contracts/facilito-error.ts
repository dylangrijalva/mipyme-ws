import z from "zod";
import { BusinessError } from "./business-error.ts";

const FacilitoError = BusinessError.extend({
  requestId: z.string(),
  status: z.int(),
});

type FacilitoError = z.infer<typeof FacilitoError>;

export { FacilitoError };
