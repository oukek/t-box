import type { FastifyInstance } from "fastify";
import type {
  ApplicationCapabilities,
  ApplicationManifest,
} from "@t-box/shared";
import { bearer } from "../identity/service.js";

export interface ApplicationCatalogPort {
  manifests: readonly ApplicationManifest[];
  capabilities(appId: string): ApplicationCapabilities;
}
export function registerApplicationCatalog(
  app: FastifyInstance,
  catalog: ApplicationCatalogPort,
  authenticate: (token: string) => Promise<unknown>,
) {
  app.get("/api/v1/applications", async (request, reply) => {
    await authenticate(bearer(request.headers.authorization));
    reply.header("Cache-Control", "no-store");
    return { data: catalog.manifests };
  });
  app.get<{ Params: { id: string } }>(
    "/api/v1/applications/:id/capabilities",
    async (request, reply) => {
      await authenticate(bearer(request.headers.authorization));
      reply.header("Cache-Control", "no-store");
      return { data: catalog.capabilities(request.params.id) };
    },
  );
}
