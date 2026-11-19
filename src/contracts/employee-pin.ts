import z from "zod";

const PIN_LENGTH = 4 as const;

const EmployeePin = z
  .string()
  .regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), `Provide a PIN made of exactly ${PIN_LENGTH} digits, such as 4821.`);

type EmployeePin = z.infer<typeof EmployeePin>;

export { EmployeePin, PIN_LENGTH };
