import { sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

// Tabelle proprie di quovibe (non ppxml2db) — text() per massima precisione

export const exchangeRates = sqliteTable('vf_exchange_rate', {
  date: text('date').notNull(),
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  rate: text('rate').notNull(),  // TEXT: nuova colonna quovibe
}, (t) => ({ pk: primaryKey({ columns: [t.date, t.fromCurrency, t.toCurrency] }) }));
