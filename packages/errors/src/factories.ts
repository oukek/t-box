/** Shared by browser, server and independent apps. Contains no application logic. */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'Error'
  }
}

export class ApiError extends CodedError {
  constructor(
    readonly statusCode: number,
    code: string,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(code, message)
    this.name = 'ApiError'
  }
}

/** Explicit HTTP serialization; internal causes, stack traces and status metadata stay private. */
export function apiErrorResponse(error: ApiError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  }
}

export interface ApiErrorVariant {
  statusCode: number
  message: string
}
export interface ApiErrorDefinition extends ApiErrorVariant {
  /** Intentional legacy HTTP variants share one registered protocol code. */
  variants?: Record<string, ApiErrorVariant>
}
type ApiFactory = ((
  message?: string,
  details?: Record<string, string>,
) => ApiError) & {
  readonly code: string
  readonly statusCode: number
}
type ApiFactories<T extends Record<string, ApiErrorDefinition>> = {
  readonly [K in keyof T]: ApiFactory & {
    readonly [V in keyof NonNullable<T[K]['variants']>]: ApiFactory
  }
}

export function defineApiErrors<
  const T extends Record<string, ApiErrorDefinition>,
>(definitions: T): ApiFactories<T> {
  function factory(code: string, definition: ApiErrorVariant): ApiFactory {
    return Object.assign(
      (message = definition.message, details?: Record<string, string>) =>
        new ApiError(definition.statusCode, code, message, details),
      { code, statusCode: definition.statusCode },
    )
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions).map(([code, definition]) => {
        const result = factory(code, definition)
        for (const [name, variant] of Object.entries(
          definition.variants ?? {},
        )) {
          Object.assign(result, {
            [name]: Object.freeze(factory(code, variant)),
          })
        }
        return [code, Object.freeze(result)]
      }),
    ),
  ) as ApiFactories<T>
}

export function defineInternalErrors<const T extends Record<string, string>>(
  namespace: string,
  definitions: T,
) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions).map(([name, message]) => [
        name,
        (override = message, options?: ErrorOptions) =>
          new CodedError(`${namespace}_${name}`, override, options),
      ]),
    ),
  ) as {
    readonly [K in keyof T]: (
      message?: string,
      options?: ErrorOptions,
    ) => CodedError
  }
}
