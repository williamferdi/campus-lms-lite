export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "You need to sign in.") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do that.") =>
  new AppError(403, "forbidden", message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const unprocessable = (message: string, details?: unknown) =>
  new AppError(422, "validation_error", message, details);

export function assert(condition: unknown, error: AppError): asserts condition {
  if (!condition) throw error;
}
