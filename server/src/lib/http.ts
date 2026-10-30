import { z } from "zod";
import { unprocessable } from "./errors.js";

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    const first = details[0];
    throw unprocessable(
      first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "Invalid input.",
      details,
    );
  }
  return result.data;
}

export const idParams = z.object({ id: z.uuid() });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

export function paged<T>(data: T[], total: number, page: number, perPage: number) {
  return {
    data,
    meta: { page, perPage, total, pageCount: Math.max(1, Math.ceil(total / perPage)) },
  };
}

/** Optional ISO date-time. `undefined` = not provided; `""`/`null` = clear. */
export const optionalDate = z
  .union([z.iso.datetime({ offset: true }), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? new Date(v) : null));

export const trimmed = (min = 1, max = 200) => z.string().trim().min(min).max(max);

export const queryBool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

export function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Drop undefined fields; reject an update that would change nothing. */
export function requireChanges<T extends object>(obj: T): Partial<T> {
  const d = definedOnly(obj);
  if (Object.keys(d).length === 0) throw unprocessable("Nothing to update.");
  return d;
}
