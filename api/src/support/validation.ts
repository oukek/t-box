import type { CustomerSupportConfiguration } from "@t-box/shared";
import { ApiError } from "@t-box/server-foundation/errors";

export function parseSupportConfiguration(
  value: unknown,
): CustomerSupportConfiguration {
  const invalid = (message: string): never => {
    throw new ApiError(400, "INVALID_SUPPORT_CONFIG", message);
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("客服配置必须是对象");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["enabled", "qrCodeUrl"].includes(key)))
    invalid("客服配置包含未支持字段");
  if (typeof input.enabled !== "boolean") invalid("客服启用状态无效");
  if (typeof input.qrCodeUrl !== "string" || input.qrCodeUrl.length > 2048)
    invalid("二维码图片地址最多 2048 字符");
  const qrCodeUrl = (input.qrCodeUrl as string).trim();
  if (qrCodeUrl) {
    try {
      const url = new URL(qrCodeUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        invalid("二维码图片请使用不带账号和锚点的 HTTPS 地址");
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      invalid("二维码图片请使用完整 HTTPS 地址");
    }
  } else if (input.enabled) invalid("开启客服前请填写二维码图片地址");
  return { enabled: input.enabled as boolean, qrCodeUrl };
}
