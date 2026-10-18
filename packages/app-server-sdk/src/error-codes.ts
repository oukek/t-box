import {
  defineInternalErrors,
} from '@t-box/errors'

import { ApplicationError } from './application-error.js'

const internalErrors = defineInternalErrors('PACKAGES_APP_SERVER_SDK', {
  INTERNAL_APPLICATION_INTERACTION_WAS_NOT_COMPLETED:
    'Application interaction was not completed',
  INTERNAL_PREPARATION_LIMIT:
    'Application preparation exceeded the interaction limit',
  INTERNAL_INVALID_REMOTE_TOOL_BINDING: 'Invalid remote tool binding',
  INTERNAL_UNDECLARED_INTERACTION:
    'Remote service requested an undeclared client interaction',
  INTERNAL_REMOTE_INSTALLATION_REQUIRED:
    'Remote tool requires an installed, pinned application context',
  INTERNAL_SERVICE_CREDENTIAL_IS_REQUIRED: 'Service credential is required',
})

export const ErrorCode = Object.freeze({ ...internalErrors })
export const ApplicationErrorCode = Object.freeze({
  INVALID_CALCULATION: (message = '计算参数无效') =>
    new ApplicationError('INVALID_CALCULATION', message),
  APP_METHOD_NOT_FOUND: (message = '应用方法不存在') =>
    new ApplicationError('APP_METHOD_NOT_FOUND', message),
})
