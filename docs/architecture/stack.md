# Technology Stack

## Guiding principles

- **One language for everything** — TypeScript end-to-end
- **Convention over configuration** — less boilerplate
- **Zero type surprises** — SQLite schema as the single source of truth
- **Docker-first** — every service is a container, SQLite on persistent volume
- **Accurate** — calculations follow standard financial formulas (TTWROR, IRR, FIFO, Moving Average)

## Stack

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | Node.js 24 | Maximum training data, native SQLite support; better-sqlite3 12.8 |
| **Web framework** | Express 5.2 | Native async in v5, huge middleware ecosystem |
| **ORM / query** | Drizzle ORM 0.45 | Schema-first, maps 1:1 to existing ppxml2db tables |
| **Frontend** | React 19.2 + Vite 8.0 | Cleanest frontend generation |
| **UI components** | shadcn/ui (Radix UI 1.4) + Tailwind CSS 4.2 | Copy-paste, no runtime dependencies |
| **Charts** | Recharts 3.8 | React-native charting |
| **Tables** | TanStack Table 8.21 | Sorting, filtering, column visibility |
| **State / fetch** | TanStack Query 5.95 | Standard for data fetching |
| **Router** | React Router 7.13 | Most training data for AI generation |
| **Database** | SQLite (via better-sqlite3 12.8) | Single file, zero infrastructure, synchronous |
| **Validation** | Zod 3.25 | Shared front/back schema |
| **Date** | date-fns 4.1 | Lightweight, tree-shakeable, immutable |
| **Math** | decimal.js 10.6 | Financial precision (no floating point) |
| **i18n** | i18next 25.10 + react-i18next 16.6 | 8-language support with standard financial terminology |
| **Forms** | react-hook-form 7.72 | Standard form library |
| **Containerization** | Docker + docker-compose | One command for everything |
| **Package manager** | pnpm 9 + workspaces | Monorepo, fast |
| **Test** | Vitest 4.1 | Identical API to Jest, faster in TS monorepo |

## Key architectural decisions

- **Express 5.2 over Hono**: Express has orders of magnitude more training data → working code on first attempt in 95%+ of cases. Express 5.2 introduces native async handlers, closing the technical gap. See ADR-007.
- **React Router v7 over TanStack Router**: More training data → fewer generation errors. See ADR-008.
- **TanStack Table**: quovibe is built around configurable data tables — indispensable.
- **decimal.js**: JS floating point causes errors in financial calculations (0.1 + 0.2 ≠ 0.3). See ADR-003.
