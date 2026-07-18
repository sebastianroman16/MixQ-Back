# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts nest-cli.json tsconfig.json tsconfig.build.json ./
RUN pnpm install --frozen-lockfile

COPY src ./src
RUN pnpm run build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-dejavu-core \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_DISABLE_SANDBOX=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node package.json ./package.json

RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node
EXPOSE 3000

CMD ["npm", "run", "start:prod"]
