# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.21.0
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@11.18.0
COPY . .
RUN --mount=type=cache,id=tbox-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm build:api
# This independently hosted system application is required by the production catalog.
RUN pnpm -r --filter "@t-box/calculator-web..." --filter "@t-box/ledger-web..." --if-present build
# Keep the pnpm 11 legacy implementation pinned; workspace files[] includes compiled dist.
RUN --mount=type=cache,id=tbox-pnpm,target=/pnpm/store \
    pnpm --filter @t-box/api deploy --legacy --prod /runtime --store-dir=/pnpm/store

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3000
WORKDIR /opt/t-box/api
COPY --from=build --chown=node:node /runtime/ ./
COPY --from=build --chown=node:node /workspace/output/app-artifacts/ /opt/t-box/bootstrap/app-artifacts/
COPY --chown=node:node scripts/serve-application-artifacts.mjs /opt/t-box/scripts/
COPY --chown=node:node deploy/api/prepare-apps.mjs deploy/api/healthcheck.mjs /opt/t-box/scripts/
COPY --chown=node:node deploy/api/check-image.mjs ./check-image.mjs
RUN mkdir -p .secrets .storage /opt/t-box/output/app-artifacts /opt/t-box/apps \
    && chown -R node:node .secrets .storage /opt/t-box/output /opt/t-box/apps
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=6s --start-period=30s --retries=3 \
    CMD ["node", "/opt/t-box/scripts/healthcheck.mjs"]
CMD ["node", "dist/server.js"]
