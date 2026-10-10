import { createDataSource } from "./db/data-source.js";
import { createClient } from "redis";
import type { getConfig } from "./config.js";
import type { DependencyHealth } from "./app.js";

export async function createDatabase(config: ReturnType<typeof getConfig>) {
  const source = await createDataSource(config.mysql).initialize();
  const redis = config.redis
    ? createClient({
        ...config.redis,
        disableOfflineQueue: true,
        socket: {
          ...config.redis.socket,
          reconnectStrategy: (retries: number) =>
            Math.min(500 * (retries + 1), 30_000),
        },
      })
    : undefined;

  // Redis is optional: it reconnects in the background and never blocks bill writes.
  redis?.on("error", () => {
    /* Exposed by /health without printing connection credentials. */
  });
  void redis?.connect().catch(() => {});

  return {
    source,
    redis,
    async health(): Promise<DependencyHealth> {
      const [mysqlResult, redisResult] = await Promise.allSettled([
        source.query("SELECT 1"),
        redis?.isReady
          ? redis.ping()
          : Promise.reject(new Error("Redis unavailable")),
      ]);
      return {
        mysql: mysqlResult.status === "fulfilled" ? "up" : "down",
        redis: !redis
          ? "disabled"
          : redisResult.status === "fulfilled"
            ? "up"
            : "down",
      };
    },
    async close() {
      if (redis?.isOpen) redis.destroy();
      await source.destroy();
    },
  };
}
