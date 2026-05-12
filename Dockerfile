# Stage 1: Base with pnpm
#
# Pin Alpine version (3.20) and pnpm (9.0.0) for reproducible builds.
# - node:24-alpine3.20 → Node 24 + Alpine 3.20 (ships python3 3.12, py3-lxml 5.2)
# - pnpm@9.0.0 matches root package.json "packageManager" field
FROM node:24-alpine3.20 AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Stage 2: Dependencies
FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json    ./packages/shared/
COPY packages/engine/package.json    ./packages/engine/
COPY packages/api/package.json       ./packages/api/
COPY packages/web/package.json       ./packages/web/
RUN pnpm install --frozen-lockfile

# Stage 3: Build
FROM deps AS build
ARG APP_VERSION=v0.0.0
ENV APP_VERSION=$APP_VERSION
COPY . .
RUN pnpm --filter @quovibe/shared build
RUN pnpm --filter @quovibe/engine build
RUN pnpm --filter @quovibe/api build
RUN pnpm --filter @quovibe/web build

# Stage 4: Runner (production)
#
# Alpine version pinned to match Stage 1 → Python 3.12 + lxml 5.2 from
# Alpine 3.20 main repo. py3-lxml is preferred over `pip install lxml`
# because the apk package ships prebuilt C extensions (no gcc/musl-dev
# needed at runtime, smaller image, faster build).
#
# ppxml2db Python deps are documented in packages/api/vendor/requirements.txt
# — keep that file and this apk line in sync if upstream adds a new import.
FROM node:24-alpine3.20 AS runner
RUN apk add --no-cache python3 py3-lxml
WORKDIR /app

COPY --from=build /app/packages/api/dist              ./packages/api/
COPY --from=build /app/packages/web/dist               ./web/dist/
COPY --from=build /app/packages/shared/dist            ./packages/shared/
COPY --from=build /app/packages/engine/dist            ./packages/engine/
COPY --from=build /app/node_modules                    ./node_modules
COPY --from=build /app/packages/api/node_modules       ./packages/api/node_modules
COPY --from=build /app/packages/shared/node_modules    ./packages/shared/node_modules
COPY --from=build /app/packages/engine/node_modules    ./packages/engine/node_modules

# XML import: Python scripts shipped with the API
COPY packages/api/vendor           ./packages/api/vendor

# ADR-015 §3.17: ship demo.db at /app/assets/ (NOT /app/data/ — the volume
# mount would hide it). The API clones it to /app/data/portfolio-demo.db the
# first time a user selects "Try demo" from the Welcome page.
COPY data/demo.db                  /app/assets/demo.db

# Build-time smoke tests:
#   1. ppxml2db Python deps load — catches a broken Alpine→py3-lxml combo
#      before the image ships rather than at first XML import.
#   2. demo.db copy is non-empty — Docker COPY does NOT fail on a missing
#      source unless `--from` is set, so without this the runner ships an
#      empty file and `Try demo` 500s the first time it's clicked.
RUN set -e \
  && python3 -c "import lxml.etree; import sqlite3; print('ppxml2db deps OK')" \
  && { test -s /app/assets/demo.db || { echo "ERROR: demo.db missing or empty"; exit 1; }; }

# Run as non-root user
RUN addgroup -S quovibe && adduser -S quovibe -G quovibe
RUN mkdir -p /app/data && chown -R quovibe:quovibe /app
USER quovibe

EXPOSE 3000
ENV NODE_ENV=production
ENV QUOVIBE_DATA_DIR=/app/data
ENV QUOVIBE_DEMO_SOURCE=/app/assets/demo.db

# Persistent runtime volume: sidecar (quovibe.settings.json) + per-portfolio
# .db files + rotated .bak.* backups live here.
VOLUME ["/app/data"]

# Healthcheck uses busybox-wget (bundled in alpine). Lives in the image so it
# applies to bare `docker run` as well as compose deployments.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
  CMD wget -q --spider http://localhost:3000/api/portfolios || exit 1

CMD ["node", "packages/api/index.js"]
