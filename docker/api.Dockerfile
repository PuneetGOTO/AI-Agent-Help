# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf
FROM ${NODE_IMAGE} AS base

ARG PNPM_VERSION=10.14.0
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /workspace

FROM base AS build
ENV NODE_ENV=production
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile --prod=false; else pnpm install --no-frozen-lockfile --prod=false; fi
RUN pnpm --filter @agent-platform/shared build
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm --filter @agent-platform/api prisma:generate
RUN pnpm --filter @agent-platform/api build
RUN pnpm --filter @agent-platform/api deploy --prod --legacy /output/api
RUN pnpm --filter @agent-platform/api deploy --legacy /output/migration
RUN cd /output/api \
    && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
      /workspace/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma
RUN cd /output/migration \
    && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
      ./node_modules/.bin/prisma generate --schema prisma/schema.prisma

FROM base AS runtime
ENV NODE_ENV=production \
    API_PORT=4000

WORKDIR /app
COPY --from=build --chown=node:node /output/api ./
USER node
EXPOSE 4000

CMD ["node", "dist/main.js"]

FROM base AS migration
ENV NODE_ENV=production

WORKDIR /app
COPY --from=build --chown=node:node /output/migration ./
USER node

CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]
