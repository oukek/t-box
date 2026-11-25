import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('PACKAGES_APP_CONTRACTS', {
  INVALID_SYSTEM_VERSION: '系统版本必须为 x.y.z，每段为无前导零的非负整数',
  INVALID_SYSTEM_VERSION_ORDER: '手动指定的版本必须高于当前已分配版本',
  INVALID_SYSTEM_VERSION_CHANGE: '未知的版本递增方式',
  INTERNAL_UNTRUSTED_APPLICATION_ORIGIN:
    'Application must use a trusted HTTPS artifact or loopback development origin',
  INTERNAL_INVALID_APPLICATION_ICON_IMAGE: 'Invalid application icon image',
  INTERNAL_INVALID_APPLICATION_ICON_PRESENTATION:
    'Invalid application icon presentation',
  INTERNAL_INVALID_APPLICATION_RELEASE: 'Invalid application release',
  INTERNAL_INVALID_UPDATE_PROMPT: 'Invalid update prompt',
  INTERNAL_INVALID_UPDATE_PROMPT_TEXT: 'Invalid update prompt text',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
