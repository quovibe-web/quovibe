// Pure helpers powering the CSV-source duplicate cleanup that runs at
// bootstrap time. Split out from apply-bootstrap.ts so the canonical-JSON
// fingerprint logic can be unit-tested without an open SQLite handle.

import type BetterSqlite3 from 'better-sqlite3';

export interface XactFingerprintInput {
  note: string | null | undefined;
  currency: string;
  fees: number;
  taxes: number;
  acctype: string;
  units: ReadonlyArray<{
    type: string;
    amount: number;
    currency: string;
    forex_amount: number | null;
    forex_currency: string | null;
    exchangeRate: string | null;
  }>;
  crossEntries: ReadonlyArray<{
    type: string;
    from_acc: string | null;
    to_acc: string;
    /** 'from' if this xact appears as the cross_entry source, 'to' otherwise. */
    role: 'from' | 'to';
  }>;
}

/**
 * Builds a deterministic canonical JSON fingerprint of an xact + its
 * dependent xact_unit + xact_cross_entry rows. Used by the CSV duplicate
 * cleanup helper to decide whether two xacts in the same natural-key group
 * are "byte-identical" (safe to collapse) or "divergent" (must survive).
 *
 * The natural-key columns themselves (date, type, security, account, shares,
 * amount) are NOT included — they're equal by construction across the group.
 *
 * Peer-xact UUIDs in cross_entry are NOT included either — they always differ
 * across duplicate groups (re-import mints fresh UUIDs). What matters is what
 * the rows MEAN, not what UUIDs they happen to point at.
 */
export function fingerprintXact(input: XactFingerprintInput): string {
  const norm = {
    note: input.note ?? null,
    currency: input.currency,
    fees: input.fees,
    taxes: input.taxes,
    acctype: input.acctype,
    units: [...input.units]
      .map((u) => ({
        type: u.type,
        amount: u.amount,
        currency: u.currency,
        forex_amount: u.forex_amount ?? null,
        forex_currency: u.forex_currency ?? null,
        exchangeRate: u.exchangeRate ?? null,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type < b.type ? -1 : 1;
        return a.amount - b.amount;
      }),
    crossEntries: [...input.crossEntries]
      .map((c) => ({
        type: c.type,
        from_acc: c.from_acc ?? null,
        to_acc: c.to_acc,
        role: c.role,
      }))
      .sort((a, b) => {
        if (a.role !== b.role) return a.role < b.role ? -1 : 1;
        if (a.type !== b.type) return a.type < b.type ? -1 : 1;
        return (a.from_acc ?? '').localeCompare(b.from_acc ?? '');
      }),
  };
  return JSON.stringify(norm);
}

export interface CsvDuplicateCleanupResult {
  /** Number of natural-key groups whose members were byte-identical. */
  collapsedGroups: number;
  /** Number of xact rows deleted (sum across all collapsed groups). */
  deletedRows: number;
  /** Number of natural-key groups whose members diverged — left untouched. */
  divergentGroups: number;
}

interface NaturalKeyGroupRow {
  date: string;
  type: string;
  security: string | null;
  account: string;
  shares: number;
  amount: number;
  n: number;
}

interface MemberRow {
  _id: number;
  uuid: string;
  note: string | null;
  currency: string;
  fees: number;
  taxes: number;
  acctype: string;
}

/**
 * Scans the xact table for natural-key groups within source='CSV_IMPORT'
 * that contain more than one row, and collapses byte-identical groups to
 * a single member (kept: lowest _id). Dependent xact_unit and
 * xact_cross_entry rows for victim xacts are deleted. Divergent groups
 * (members that differ on note/units/cross-entries) are left untouched
 * with a logged warning.
 *
 * Idempotent. Safe to call on any DB with the xact / xact_unit /
 * xact_cross_entry tables — no effect on DBs without CSV-source duplicates.
 *
 * Wrapped in a single db.transaction() so partial cleanup never persists.
 */
export function cleanupCsvDuplicates(db: BetterSqlite3.Database): CsvDuplicateCleanupResult {
  const groups = db.prepare(`
    SELECT date, type, security, account, shares, amount, COUNT(*) AS n
    FROM xact
    WHERE source = 'CSV_IMPORT'
    GROUP BY date, type, security, account, shares, amount
    HAVING n > 1
  `).all() as NaturalKeyGroupRow[];

  if (groups.length === 0) {
    return { collapsedGroups: 0, deletedRows: 0, divergentGroups: 0 };
  }

  let collapsedGroups = 0; // native-ok
  let deletedRows = 0; // native-ok
  let divergentGroups = 0; // native-ok

  // SECURITY note: the natural-key SELECT below uses `security IS ?` rather
  // than `security = ?` so that NULL securities (cash-only types) match
  // correctly when fetched back. SQLite's IS operator handles NULL the way
  // we want here.
  const memberStmt = db.prepare(`
    SELECT _id, uuid, note, currency, fees, taxes, acctype
    FROM xact
    WHERE source = 'CSV_IMPORT'
      AND date = ? AND type = ? AND security IS ?
      AND account = ? AND shares = ? AND amount = ?
    ORDER BY _id ASC
  `);
  const unitsStmt = db.prepare(
    'SELECT type, amount, currency, forex_amount, forex_currency, exchangeRate FROM xact_unit WHERE xact = ?',
  );
  const crossStmtFrom = db.prepare(
    'SELECT type, from_acc, to_acc FROM xact_cross_entry WHERE from_xact = ?',
  );
  const crossStmtTo = db.prepare(
    'SELECT type, from_acc, to_acc FROM xact_cross_entry WHERE to_xact = ?',
  );

  const deleteUnitStmt = db.prepare('DELETE FROM xact_unit WHERE xact = ?');
  const deleteCrossStmt = db.prepare('DELETE FROM xact_cross_entry WHERE from_xact = ? OR to_xact = ?');
  const deleteXactStmt = db.prepare('DELETE FROM xact WHERE _id = ?');

  db.transaction(() => {
    for (const g of groups) {
      const members = memberStmt.all(
        g.date, g.type, g.security, g.account, g.shares, g.amount,
      ) as MemberRow[];

      const fingerprints = members.map((m) => {
        const units = unitsStmt.all(m.uuid) as Array<{
          type: string; amount: number; currency: string;
          forex_amount: number | null; forex_currency: string | null; exchangeRate: string | null;
        }>;
        const fromRows = crossStmtFrom.all(m.uuid) as Array<{ type: string; from_acc: string | null; to_acc: string }>;
        const toRows = crossStmtTo.all(m.uuid) as Array<{ type: string; from_acc: string | null; to_acc: string }>;
        const crossEntries = [
          ...fromRows.map((r) => ({ ...r, role: 'from' as const })),
          ...toRows.map((r) => ({ ...r, role: 'to' as const })),
        ];
        return fingerprintXact({
          note: m.note,
          currency: m.currency,
          fees: m.fees,
          taxes: m.taxes,
          acctype: m.acctype,
          units,
          crossEntries,
        });
      });

      const allIdentical = fingerprints.every((f) => f === fingerprints[0]);
      if (!allIdentical) {
        // eslint-disable-next-line no-console
        console.warn(
          `[csv-dedupe] natural-key group at ${g.date}/${g.type}/${g.account} has divergent members — leaving untouched`,
        );
        divergentGroups++; // native-ok
        continue;
      }

      const survivor = members[0];
      const victims = members.slice(1);
      for (const v of victims) {
        deleteUnitStmt.run(v.uuid);
        deleteCrossStmt.run(v.uuid, v.uuid);
        deleteXactStmt.run(v._id);
        deletedRows++; // native-ok
      }
      collapsedGroups++; // native-ok
      // eslint-disable-next-line no-console
      console.info(
        `[csv-dedupe] collapsed ${members.length} → 1 at ${g.date}/${g.type}, kept _id=${survivor._id}`,
      );
    }
  })();

  return { collapsedGroups, deletedRows, divergentGroups };
}
