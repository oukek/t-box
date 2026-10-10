import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlatformService } from "./service.js";
import { bearer } from "../identity/service.js";
import { registerLedger } from "@t-box/ledger-server";
export function registerPlatform(app: FastifyInstance, p: PlatformService) {
  const principal = (req: FastifyRequest) =>
    p.identity.authenticate(bearer(req.headers.authorization));
  app.post("/api/v1/auth/register", async (req, reply) =>
    reply.code(201).send({ data: await p.identity.register(req.body, req.ip) }),
  );
  app.post("/api/v1/auth/login", async (req) => ({
    data: await p.identity.login(req.body, req.ip),
  }));
  app.get("/api/v1/auth/me", async (req) => ({
    data: (await principal(req)).user,
  }));
  app.patch("/api/v1/auth/me", async (req) => ({
    data: await p.identity.updateProfile(await principal(req), req.body),
  }));
  app.delete("/api/v1/auth/session", async (req, reply) => {
    await p.identity.logout(await principal(req));
    return reply.code(204).send();
  });
  app.patch("/api/v1/auth/password", async (req, reply) => {
    await p.identity.changePassword(await principal(req), req.body);
    return reply.code(204).send();
  });
  registerLedger(app, p);
}
