# Stage 1: Base with pnpm
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
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
FROM node:24-alpine AS runner
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

# XML import: Python scripts + bootstrap DB + entrypoint
COPY data/schema.db                ./bootstrap/schema.db
COPY packages/api/vendor           ./packages/api/vendor
COPY docker-entrypoint.sh         .
RUN chmod +x docker-entrypoint.sh

# Run as non-root user
RUN addgroup -S quovibe && adduser -S quovibe -G quovibe
RUN mkdir -p /app/data && chown -R quovibe:quovibe /app
USER quovibe

EXPOSE 3000
ENV NODE_ENV=production
ENV DB_PATH=/app/data/portfolio.db
ENV SCHEMA_PATH=/app/bootstrap/schema.db
CMD ["sh", "/app/docker-entrypoint.sh"]
