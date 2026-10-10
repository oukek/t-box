import { DateTimeError } from "@t-box/dayjs";
import { ApiError } from "../errors.js";
export function temporalDomain<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof DateTimeError)
      throw new ApiError(400, "INVALID_DATETIME", error.message);
    throw error;
  }
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new ApiError(400, "REVISION_REQUIRED", "请提供有效的数据版本");
  return Number(value);
}
