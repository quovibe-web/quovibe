# Operations

## Date Handling

**Rule**: all dates in quovibe are user-local dates (`YYYY-MM-DD`), never UTC timestamps.

**Rationale**: quovibe uses pure dates (day only, no time). A transaction on 31/12/2024 is "December 31, 2024" regardless of the server's timezone.

Implementation:
- Node.js server NEVER converts dates to UTC
- Dates arrive from frontend as `YYYY-MM-DD` string
- Dates saved as `TEXT YYYY-MM-DD` in the DB
- date-fns: always use non-UTC functions (`parseISO`, `format`, `differenceInDays`)
- Frontend: always use `new Date(dateString + 'T00:00:00')` to avoid off-by-one
- `updatedAt` and system timestamps use ISO 8601 UTC. Only financial dates are pure dates.

## Docker Setup

### Production

```yaml
# docker-compose.yml
services:
  quovibe:
    build: .
    ports: ["${PORT:-3000}:3000"]
    volumes: ["./data:/app/data"]
    environment:
      - DB_PATH=/app/data/portfolio.db
      - NODE_ENV=production
    restart: unless-stopped
```

Multi-stage Dockerfile: deps → build → runner (Node 22 Alpine). Express serves frontend as static files on port 3000.

### Development (without Docker)

```bash
ppxml2db portfolio.xml data/portfolio.db   # Convert XML to SQLite
pnpm install
pnpm dev          # starts api + web in parallel
pnpm test         # Vitest on the entire monorepo
```

## Environment Variables

```bash
# Database
DB_PATH=./data/portfolio.db
DB_BACKUP_MAX=3                    # Max backups to keep

# Server
PORT=3000
NODE_ENV=development

# Prices
ECB_RATES_URL=https://data.ecb.europa.eu/stats/policy_and_exchange_rates
PRICE_FETCH_INTERVAL_MS=1000
PRICE_FETCH_MAX_CONCURRENT=5
PRICE_CRON_SCHEDULE="0 18 * * 1-5"   # Weekdays at 18:00

# Logging
LOG_LEVEL=info
```

DO NOT use `YAHOO_FINANCE_PROXY` — use the yahoo-finance2 library directly.

## Backup and Recovery

### 1. WAL-safe backup

`backupDb()` in `packages/api/src/db/client.ts` uses `VACUUM INTO` (not `fs.copyFileSync`, which is unsafe for WAL-mode databases).

Backup filename: `portfolio.db.bak.{timestamp}`. Rotation: keep last `DB_BACKUP_MAX` backups.

### 2. Manual export from UI

`GET /api/portfolio/export` — streams the SQLite file as `application/x-sqlite3`. The user can re-import it in ppxml2db or another quovibe instance.

### 3. Import safety infrastructure

`reloadApp()` in `packages/api/src/index.ts`:
1. **Drain guard**: waits for in-flight HTTP requests to finish (5s timeout)
2. **Backup old DB** (VACUUM INTO, requires open handle)
3. **Stop price scheduler** (terminates worker thread)
4. **WAL checkpoint**: `wal_checkpoint(TRUNCATE)` before close
5. **Atomic file swap**: `copyFileSync` → `renameSync` (atomic on most filesystems)
6. **Defensive cleanup** of stale `.swap` from previous crash
7. Open fresh DB + create new Express app + start new scheduler

### 4. Docker volume

`docker-compose.yml` mounts `./data` as a host volume. The user is responsible for backing up the volume.

## SQLite Configuration

At DB connection initialization (see ADR-010):

```
PRAGMA journal_mode = WAL;       -- concurrent reads during writes
PRAGMA synchronous = FULL;       -- fsync WAL after every commit, safe on OS crash
PRAGMA foreign_keys = ON;        -- enforces FK constraints
```

> Source: `packages/api/src/db/open-db.ts`
