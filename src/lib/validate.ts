import type { z } from "zod";
import { ValidationError } from "./errors";

/** Parses input with a Zod schema, turning problems into a ValidationError with one message per field. */
export function parseInput<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of r.error.issues)
      fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
    throw new ValidationError(
      Object.values(fieldErrors)[0] ?? "Please check the form.",
      fieldErrors,
    );
  }
  return r.data;
}
