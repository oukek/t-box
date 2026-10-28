# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.21.0
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@11.18.0
COPY . .
RUN --mount=type=cache,id=tbox-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm build:api
# Discover applications from the same declarations used by the release workflow.
RUN node scripts/build-bootstrap-applications.mjs /bootstrap-artifacts
# Keep the pnpm 11 legacy implementation pinned; workspace files[] includes compiled dist.
RUN --mount=type=cache,id=tbox-pnpm,target=/pnpm/store \
    pnpm --filter @t-box/api deploy --legacy --prod /runtime --store-dir=/pnpm/store
RUN node scripts/application-bootstrap.mjs /bootstrap-artifacts /runtime/bootstrap-applications.json

FROM scratch AS application-artifacts
COPY --from=build /bootstrap-artifacts/ /

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=127.0.0.1 PORT=6868
WORKDIR /opt/t-box/api
COPY --from=build --chown=node:node /runtime/ ./
COPY --chown=node:node deploy/api/healthcheck.mjs /opt/t-box/scripts/
COPY --chown=node:node deploy/api/check-image.mjs ./check-image.mjs
RUN mkdir -p .secrets && chown -R node:node .secrets
USER node
EXPOSE 6868
HEALTHCHECK --interval=30s --timeout=6s --start-period=30s --retries=3 \
    CMD ["node", "/opt/t-box/scripts/healthcheck.mjs"]
CMD ["node", "dist/server.js"]
