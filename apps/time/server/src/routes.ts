import type { FastifyInstance, FastifyRequest } from "fastify";
import { timeSnapshot, calculateTime } from "@t-box/time-contracts";
import { bearer } from "@t-box/server-foundation/auth";
import type { Actor } from "@t-box/app-server-sdk";
import { temporalDomain } from "@t-box/server-foundation/persistence/errors";
import type { TimeService } from "./service.js";
export function registerTime(
  app: FastifyInstance,
  service: TimeService,
  authenticate: (token: string) => Promise<Actor>,
) {
  const user = async (req: FastifyRequest) =>
    (await authenticate(bearer(req.headers.authorization))).user.id;
  const id = (req: FastifyRequest) => (req.params as { id: string }).id,
    key = (req: FastifyRequest) => req.headers["idempotency-key"];
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/v1/time"))
      reply.header("Cache-Control", "no-store");
  });
  app.get("/api/v1/time/now", async (req) => {
    await user(req);
    return {
      data: temporalDomain(() =>
        timeSnapshot((req.query as { timezone?: string }).timezone),
      ),
    };
  });
  app.post("/api/v1/time/calculations", async (req) => {
    await user(req);
    return { data: temporalDomain(() => calculateTime(req.body)) };
  });
  app.get("/api/v1/time/timers", async (req) => ({
    data: await service.list(await user(req)),
  }));
  app.post("/api/v1/time/timers", async (req, reply) =>
    reply.code(201).send({
      data: await service.create(await user(req), key(req), req.body),
    }),
  );
  app.post("/api/v1/time/timers/:id/actions", async (req) => ({
    data: await service.control(await user(req), id(req), key(req), req.body),
  }));
  app.delete("/api/v1/time/timers/:id", async (req) => ({
    data: await service.remove(await user(req), id(req), key(req), req.body),
  }));
}
