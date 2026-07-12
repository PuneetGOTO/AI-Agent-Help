# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base

ARG PNPM_VERSION=10.14.0
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /workspace

FROM base AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ARG API_PROXY_URL=http://api:4000
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_STANDALONE=true \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    API_PROXY_URL=${API_PROXY_URL}
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile --prod=false; else pnpm install --no-frozen-lockfile --prod=false; fi
RUN pnpm --filter @agent-platform/shared build
RUN pnpm --filter @agent-platform/web build

FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
