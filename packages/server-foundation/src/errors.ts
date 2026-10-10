export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function invalid(field: string, message: string): never {
  throw new ApiError(400, "VALIDATION_ERROR", "请检查填写的内容", {
    [field]: message,
  });
}
