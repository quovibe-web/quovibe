import { sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

// ── DDL (single source of truth for CREATE TABLE) ────────────────────────────

/** Raw DDL for runtime table creation in applyExtensions(). */
export const VF_EXCHANGE_RATE_DDL = `
  CREATE TABLE IF NOT EXISTS vf_exchange_rate (
    date TEXT NOT NULL,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate TEXT NOT NULL,
    PRIMARY KEY (date, from_currency, to_currency)
  )
`;

// ── Drizzle ORM schema (for type-safe queries) ──────────────────────────────

export const exchangeRates = sqliteTable('vf_exchange_rate', {
  date: text('date').notNull(),
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  rate: text('rate').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.date, t.fromCurrency, t.toCurrency] }) }));
