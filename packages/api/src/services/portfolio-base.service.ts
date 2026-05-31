import type BetterSqlite3 from 'better-sqlite3';

export class PortfolioBaseError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PortfolioBaseError';
  }
}

const ISO_4217_REGEX = /^[A-Z]{3}$/;

export function isValidIso4217(code: string): boolean {
  return ISO_4217_REGEX.test(code);
}

export function getPortfolioBaseCurrency(sqlite: BetterSqlite3.Database): string {
  const meta = sqlite
    .prepare(`SELECT value FROM vf_portfolio_meta WHERE key = 'baseCurrency'`)
    .get() as { value: string } | undefined;
  if (meta?.value && isValidIso4217(meta.value)) return meta.value;

  const acct = sqlite
    .prepare(
      `SELECT currency FROM account
       WHERE type = 'account' AND currency IS NOT NULL
       ORDER BY _order ASC, _id ASC LIMIT 1`,
    )
    .get() as { currency: string } | undefined;
  if (acct?.currency && isValidIso4217(acct.currency)) return acct.currency;

  const sec = sqlite
    .prepare(
      `SELECT currency FROM security
       WHERE currency IS NOT NULL
       ORDER BY _id ASC LIMIT 1`,
    )
    .get() as { currency: string } | undefined;
  if (sec?.currency && isValidIso4217(sec.currency)) return sec.currency;

  console.warn('[portfolio-base] no baseCurrency, no deposit, no security — falling back to EUR');
  return 'EUR';
}

export function setPortfolioBaseCurrency(
  sqlite: BetterSqlite3.Database,
  code: string,
): void {
  if (!isValidIso4217(code)) {
    throw new PortfolioBaseError(
      'INVALID_CURRENCY_CODE',
      `Base currency must be ISO-4217 (3 uppercase letters), got ${JSON.stringify(code)}`,
    );
  }
  sqlite
    .prepare(
      `INSERT INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(code);
}
