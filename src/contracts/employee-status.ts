import z from "zod";

const EmployeeStatus = z.union([z.literal("enabled"), z.literal("disabled"), z.literal("archived")]);

type EmployeeStatus = z.infer<typeof EmployeeStatus>;

export { EmployeeStatus };
