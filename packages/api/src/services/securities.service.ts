import type BetterSqlite3 from 'better-sqlite3';

// BUG-117: typed service-layer error. Route handlers map DUPLICATE_ISIN to 409.
// Mirrors AccountServiceError in accounts.service.ts.
export class SecurityServiceError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'SecurityServiceError';
  }
}

// BUG-117: case-insensitive duplicate-ISIN guard, scoped to one portfolio DB.
// Null/empty ISIN is allowed (security may have no ISIN — e.g. crypto, custom).
// `selfId` lets the update path skip its own row.
function assertUniqueIsin(
  sqlite: BetterSqlite3.Database,
  isin: string | null | undefined,
  selfId?: string,
): void {
  if (!isin) return;
  const target = isin.trim().toUpperCase();
  if (!target) return;
  const row = sqlite
    .prepare(
      selfId
        ? 'SELECT uuid FROM security WHERE UPPER(isin) = ? AND uuid != ? LIMIT 1'
        : 'SELECT uuid FROM security WHERE UPPER(isin) = ? LIMIT 1',
    )
    .get(...(selfId ? [target, selfId] : [target])) as { uuid: string } | undefined;
  if (row) throw new SecurityServiceError('DUPLICATE_ISIN');
}

/**
 * Creates a security + optional FEED properties in a single transaction.
 */
export function createSecurity(
  sqlite: BetterSqlite3.Database,
  params: {
    id: string;
    name: string;
    isin: string | null;
    ticker: string | null;
    wkn: string | null;
    currency: string;
    note: string | null;
    isRetired: boolean;
    feedUrl: string | null;
    feed: string | null;
    latestFeedUrl: string | null;
    latestFeed: string | null;
    feedTickerSymbol: string | null;
    calendar: string | null;
    onlineId: string | null;
    pathToDate?: string;
    pathToClose?: string;
  },
): void {
  sqlite.transaction(() => {
    assertUniqueIsin(sqlite, params.isin);
    sqlite.prepare(
      `INSERT INTO security (uuid, name, isin, tickerSymbol, wkn, currency, note, isRetired,
       feedURL, feed, latestFeedURL, latestFeed, feedTickerSymbol, calendar, onlineId, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      params.id, params.name, params.isin, params.ticker, params.wkn,
      params.currency, params.note, params.isRetired ? 1 : 0,
      params.feedUrl, params.feed, params.latestFeedUrl,
      params.latestFeed, params.feedTickerSymbol, params.calendar,
      params.onlineId, new Date().toISOString(),
    );

    if (params.feed) {
      sqlite.prepare(`DELETE FROM security_prop WHERE security = ? AND type = 'FEED'`).run(params.id);
      const insertProp = sqlite.prepare(
        `INSERT INTO security_prop (security, type, name, value, seq) VALUES (?, 'FEED', ?, ?, ?)`,
      );
      let seq = 0;
      if (params.pathToDate) insertProp.run(params.id, 'GENERIC-JSON-DATE', params.pathToDate, seq++);
      if (params.pathToClose) insertProp.run(params.id, 'GENERIC-JSON-CLOSE', params.pathToClose, seq++);
    }
  })();
}

/**
 * Updates a security's fields + optional FEED properties in a single transaction.
 */
export function updateSecurity(
  sqlite: BetterSqlite3.Database,
  id: string,
  input: {
    name?: string;
    isin?: string;
    ticker?: string;
    wkn?: string;
    currency?: string;
    note?: string;
    feedUrl?: string;
    feed?: string;
    isRetired?: boolean;
    calendar?: string;
    latestFeed?: string;
    latestFeedUrl?: string;
    feedTickerSymbol?: string;
    onlineId?: string;
    pathToDate?: string;
    pathToClose?: string;
  },
): void {
  sqlite.transaction(() => {
    if (input.isin !== undefined) assertUniqueIsin(sqlite, input.isin, id);
    const setClauses: string[] = [];
    const values: unknown[] = [];
    if (input.name !== undefined) { setClauses.push('name = ?'); values.push(input.name); }
    if (input.isin !== undefined) { setClauses.push('isin = ?'); values.push(input.isin); }
    if (input.ticker !== undefined) { setClauses.push('tickerSymbol = ?'); values.push(input.ticker); }
    if (input.wkn !== undefined) { setClauses.push('wkn = ?'); values.push(input.wkn); }
    if (input.currency !== undefined) { setClauses.push('currency = ?'); values.push(input.currency); }
    if (input.note !== undefined) { setClauses.push('note = ?'); values.push(input.note); }
    if (input.feedUrl !== undefined) { setClauses.push('feedURL = ?'); values.push(input.feedUrl); }
    if (input.feed !== undefined) { setClauses.push('feed = ?'); values.push(input.feed); }
    if (input.isRetired !== undefined) { setClauses.push('isRetired = ?'); values.push(input.isRetired ? 1 : 0); }
    if (input.calendar !== undefined) { setClauses.push('calendar = ?'); values.push(input.calendar); }
    if (input.latestFeed !== undefined) { setClauses.push('latestFeed = ?'); values.push(input.latestFeed); }
    if (input.latestFeedUrl !== undefined) { setClauses.push('latestFeedURL = ?'); values.push(input.latestFeedUrl); }
    if (input.feedTickerSymbol !== undefined) { setClauses.push('feedTickerSymbol = ?'); values.push(input.feedTickerSymbol); }
    if (input.onlineId !== undefined) { setClauses.push('onlineId = ?'); values.push(input.onlineId); }
    setClauses.push('updatedAt = ?'); values.push(new Date().toISOString());
    values.push(id);
    sqlite.prepare(`UPDATE security SET ${setClauses.join(', ')} WHERE uuid = ?`).run(...values);

    if (input.feed !== undefined || input.pathToDate !== undefined || input.pathToClose !== undefined) {
      sqlite.prepare(`DELETE FROM security_prop WHERE security = ? AND type = 'FEED'`).run(id);
      const insertProp = sqlite.prepare(
        `INSERT INTO security_prop (security, type, name, value, seq) VALUES (?, 'FEED', ?, ?, ?)`,
      );
      let seq = 0;
      const feedProps: Record<string, string | undefined> = {
        'GENERIC-JSON-DATE': input.pathToDate,
        'GENERIC-JSON-CLOSE': input.pathToClose,
      };
      for (const [name, value] of Object.entries(feedProps)) {
        if (value) insertProp.run(id, name, value, seq++);
      }
    }
  })();
}

/**
 * Diff-applies the incoming taxonomy assignments for a security in a single
 * transaction. Preserves primary keys on untouched rows (BUG-88): rows with
 * unchanged (taxonomyId, categoryId, weight) are skipped; changed weights
 * UPDATE in place; new keys INSERT; removed keys DELETE (with their
 * taxonomy_assignment_data cascade). Duplicate incoming keys are summed and
 * capped at 10000, matching `createAssignment`'s merge semantics.
 */
export function updateSecurityTaxonomies(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  assignments: Array<{ categoryId: string; taxonomyId: string; weight?: number | null }>,
): void {
  const keyOf = (taxonomyId: string, categoryId: string) => `${taxonomyId}|${categoryId}`;

  const incoming = new Map<string, { taxonomyId: string; categoryId: string; weight: number }>();
  for (const a of assignments) {
    const key = keyOf(a.taxonomyId, a.categoryId);
    const w = a.weight ?? 10000;
    const existing = incoming.get(key);
    if (existing) {
      existing.weight = Math.min(existing.weight + w, 10000);
    } else {
      incoming.set(key, { taxonomyId: a.taxonomyId, categoryId: a.categoryId, weight: w });
    }
  }

  sqlite.transaction(() => {
    const existingRows = sqlite
      .prepare(
        `SELECT _id, taxonomy, category, weight FROM taxonomy_assignment
         WHERE item = ? AND item_type = 'security'`,
      ).all(securityId) as Array<{ _id: number; taxonomy: string; category: string; weight: number }>;

    const existingByKey = new Map<string, { _id: number; weight: number }>();
    for (const r of existingRows) existingByKey.set(keyOf(r.taxonomy, r.category), { _id: r._id, weight: r.weight });

    const updateWeight = sqlite.prepare(`UPDATE taxonomy_assignment SET weight = ? WHERE _id = ?`);
    const deleteData = sqlite.prepare(`DELETE FROM taxonomy_assignment_data WHERE assignment = ?`);
    const deleteRow = sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE _id = ?`);
    const insertRow = sqlite.prepare(
      `INSERT INTO taxonomy_assignment (item, category, taxonomy, item_type, weight, rank)
       VALUES (?, ?, ?, 'security', ?, ?)`,
    );

    // Per-category in-memory rank counter for new INSERTs so two same-category
    // inserts in one transaction don't collide on MAX(rank)+1.
    const nextRankByCategory = new Map<string, number>();
    const getNextRank = (categoryId: string): number => {
      let next = nextRankByCategory.get(categoryId);
      if (next === undefined) {
        const row = sqlite.prepare(
          `SELECT COALESCE(MAX(rank), -1) + 1 AS next FROM taxonomy_assignment WHERE category = ?`,
        ).get(categoryId) as { next: number };
        next = row.next;
      }
      nextRankByCategory.set(categoryId, next + 1);
      return next;
    };

    for (const [key, row] of incoming) {
      const existing = existingByKey.get(key);
      if (!existing) {
        insertRow.run(securityId, row.categoryId, row.taxonomyId, row.weight, getNextRank(row.categoryId));
      } else if (existing.weight !== row.weight) {
        updateWeight.run(row.weight, existing._id);
      }
    }

    for (const [key, existing] of existingByKey) {
      if (!incoming.has(key)) {
        deleteData.run(existing._id);
        deleteRow.run(existing._id);
      }
    }
  })();
}

/**
 * Updates security feed columns + replaces all FEED properties in a single transaction.
 */
export function updateSecurityFeedConfig(
  sqlite: BetterSqlite3.Database,
  id: string,
  body: {
    feed?: string;
    feedUrl?: string;
    pathToDate?: string;
    pathToClose?: string;
    dateFormat?: string;
    factor?: number;
  },
): void {
  sqlite.transaction(() => {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    if (body.feed !== undefined) { setClauses.push('feed = ?'); values.push(body.feed); }
    if (body.feedUrl !== undefined) { setClauses.push('feedURL = ?'); values.push(body.feedUrl); }
    setClauses.push('updatedAt = ?'); values.push(new Date().toISOString());
    values.push(id);
    sqlite.prepare(`UPDATE security SET ${setClauses.join(', ')} WHERE uuid = ?`).run(...values);

    sqlite.prepare(`DELETE FROM security_prop WHERE security = ? AND type = 'FEED'`).run(id);
    const insertProp = sqlite.prepare(
      `INSERT INTO security_prop (security, type, name, value, seq) VALUES (?, 'FEED', ?, ?, ?)`,
    );
    let seq = 0;
    if (body.pathToDate) insertProp.run(id, 'GENERIC-JSON-DATE', body.pathToDate, seq++);
    if (body.pathToClose) insertProp.run(id, 'GENERIC-JSON-CLOSE', body.pathToClose, seq++);
    if (body.dateFormat) insertProp.run(id, 'GENERIC-JSON-DATE-FORMAT', body.dateFormat, seq++);
    if (body.factor != null) insertProp.run(id, 'GENERIC-JSON-FACTOR', String(body.factor), seq++);
  })();
}

/**
 * Deletes a security and ALL dependent rows (9 tables) in a single transaction.
 */
export function deleteSecurity(
  sqlite: BetterSqlite3.Database,
  id: string,
): void {
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM security_attr WHERE security = ?').run(id);
    sqlite.prepare('DELETE FROM security_prop WHERE security = ?').run(id);
    sqlite.prepare(
      `DELETE FROM taxonomy_assignment_data WHERE assignment IN
       (SELECT _id FROM taxonomy_assignment WHERE item = ? AND item_type = 'security')`,
    ).run(id);
    sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE item = ? AND item_type = 'security'`).run(id);
    sqlite.prepare('DELETE FROM price WHERE security = ?').run(id);
    sqlite.prepare('DELETE FROM latest_price WHERE security = ?').run(id);
    sqlite.prepare('DELETE FROM security_event WHERE security = ?').run(id);
    sqlite.prepare('DELETE FROM watchlist_security WHERE security = ?').run(id);
    sqlite.prepare('DELETE FROM security WHERE uuid = ?').run(id);
  })();
}
