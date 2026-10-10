import OpenAI from "openai";
/** Normalize transport errors only while reading the SDK stream, never caller callbacks or billing. */
export async function* providerStream<T>(
  stream: AsyncIterable<T>,
): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();
  try {
    for (;;) {
      let next: IteratorResult<T>;
      try {
        next = await iterator.next();
      } catch (error) {
        if (error instanceof OpenAI.APIError) throw error;
        let cause: unknown = error;
        for (
          let depth = 0;
          depth < 4 && cause && typeof cause === "object";
          depth++
        ) {
          const value = cause as { code?: string; cause?: unknown };
          if (
            [
              "ECONNRESET",
              "ETIMEDOUT",
              "UND_ERR_SOCKET",
              "UND_ERR_BODY_TIMEOUT",
              "UND_ERR_CONNECT_TIMEOUT",
              "UND_ERR_HEADERS_TIMEOUT",
            ].includes(value.code || "")
          )
            throw new OpenAI.APIConnectionError({
              message: "Provider stream connection interrupted",
              cause: error instanceof Error ? error : undefined,
            });
          cause = value.cause;
        }
        throw error;
      }
      if (next.done) return;
      yield next.value;
    }
  } finally {
    // Stream cleanup must not replace the original provider/caller error.
    await iterator.return?.().catch(() => {});
  }
}
