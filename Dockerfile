# syntax=docker/dockerfile:1
# Self-hosted image (docs/07): the SvelteKit app built with adapter-node. The build stage runs once on the build
# machine's platform (the output is plain JavaScript); the runtime stage is multi-arch (linux/amd64, linux/arm64).
ARG NODE_VERSION=22

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build
# corepack doesn't handle pnpm 12 yet.
RUN npm install --global pnpm@12.6.0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile \
 && pnpm --filter @versiondrift/web build:node \
 && pnpm --filter @versiondrift/web deploy --prod /out

FROM node:${NODE_VERSION}-alpine
LABEL org.opencontainers.image.title="VersionDrift" \
      org.opencontainers.image.description="See how far your software stack has drifted from upstream." \
      org.opencontainers.image.source="https://github.com/DamirManyapov/versiondrift" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    VD_MODE=selfhosted \
    VD_DATA_DIR=/data \
    PUBLIC_FEED_URL=/feed/
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/web/build ./build
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "build/index.js"]
