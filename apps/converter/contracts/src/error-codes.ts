import { defineApiErrors } from '@t-box/errors'

export const ConverterErrorCode = defineApiErrors({
  CONVERTER_INVALID_INPUT: { statusCode: 400, message: '换算参数无效' },
  CONVERTER_UNKNOWN_UNIT: { statusCode: 400, message: '单位不存在或不属于所选类别' },
  CONVERTER_OUT_OF_RANGE: { statusCode: 400, message: '数值超出支持范围' },
})
