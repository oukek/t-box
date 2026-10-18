import {
  defineInternalErrors,
} from '@t-box/errors'

const internalErrors = defineInternalErrors('PACKAGES_APP_CONTRACTS', {
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
