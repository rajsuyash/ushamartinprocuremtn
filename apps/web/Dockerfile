# Build context MUST be the repo root (pnpm workspace) — invoke as:
#   docker build -f apps/web/Dockerfile .
# (docker-compose.yml wires this up already).

FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /repo

# Workspace manifests only, for a cacheable install layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

# Explicit source paths only — never a wholesale `COPY apps/web .`, which would pull in the
# host's macOS node_modules/.next/tsbuildinfo and clobber the Linux install above.
COPY apps/web/next.config.ts apps/web/tsconfig.json apps/web/postcss.config.mjs apps/web/next-env.d.ts apps/web/
COPY apps/web/src apps/web/src
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
# F9 prompt artifacts — read at runtime from <cwd>/../../prompts (= /repo/prompts)
COPY prompts prompts

RUN pnpm --filter @pdi/web build

# Fresh runtime stage — only the built output, no build-time tooling/cache.
FROM node:22-alpine
WORKDIR /repo
COPY --from=builder /repo /repo
WORKDIR /repo/apps/web

EXPOSE 3000
# No pnpm at runtime: `pnpm start` makes corepack fetch pnpm from the network at
# CONTAINER START, and newer corepack prompts for confirmation → instant exit 0.
# The next binary is already in node_modules; invoke it directly.
CMD ["node_modules/.bin/next", "start"]
