import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('ADMIN', {
  INTERNAL_APPLICATION_EXECUTION_FAILED: '操作执行失败',
  INTERNAL_128_KB: '图标最大 128 KB',
  INTERNAL_2000_5_MB_20_MB: '最多 2000 个文件，单文件 5 MB，完整应用 20 MB',
  INTERNAL_PNG_JPEG_WEBP_GIF_SVG: '请选择 PNG、JPEG、WebP、GIF 或 SVG 图标',
  INTERNAL_SVG: '图标格式无效；SVG 仅支持静态矢量图形',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
