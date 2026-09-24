import z from "zod";

const JsonWebTokenPayload = z.looseObject({
  sub: z.string(),
  email: z.string(),
});

type JsonWebTokenPayload = z.infer<typeof JsonWebTokenPayload> & { [claim: string]: unknown };

export { JsonWebTokenPayload };
