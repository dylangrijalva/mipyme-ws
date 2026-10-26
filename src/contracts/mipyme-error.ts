import z from "zod";
import { BusinessError } from "./business-error.ts";

const MipymeError = BusinessError.extend({
  requestId: z.string(),
  status: z.int(),
});

type MipymeError = z.infer<typeof MipymeError>;

export { MipymeError };
