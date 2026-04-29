import Decimal from 'decimal.js';
import type Database from 'better-sqlite3';
import { convertAmountFromDb } from './unit-conversion';
import { getStatementOfAssets } from './performance.service';
import { getReferenceData } from './reference-data';

// ─── Holdings ───────────────────────────────────────────────

interface SecurityDetail {
  securityId: string;
  name: string;
  weight: number;
  marketValue: string;
  isAccount: boolean;
  isRetired: boolean;
  logoUrl: string | null;
}

interface HoldingsResult {
  date: string;
  taxonomyId?: string;
  items: unknown[];
  totalMarketValue: string;
}

export function getHoldingsFlat(sqlite: Database.Database, date: string): HoldingsResult {
  const statement = getStatementOfAssets(sqlite, date);
  const totalMV = new Decimal(statement.totals.marketValue);

  const items = statement.securities.map((s) => ({
    securityId: s.securityId,
    name: s.name,
    marketValue: s.marketValue,
    percentage: totalMV.gt(0)
      ? new Decimal(s.marketValue).div(totalMV).mul(100).toFixed(2)
      : '0',
  }));

  return { date, items, totalMarketValue: totalMV.toString() };
}

export function getHoldingsByTaxonomy(
  sqlite: Database.Database,
  date: string,
  taxonomyId: string,
): HoldingsResult {
  const statement = getStatementOfAssets(sqlite, date);

  // Get root category UUID for this taxonomy
  const taxonomyRow = sqlite
    .prepare(`SELECT root FROM taxonomy WHERE uuid = ?`)
    .get(taxonomyId) as { root: string | null } | undefined;
  const rootCategoryUuid = taxonomyRow?.root ?? null;

  const categories = sqlite
    .prepare(
      `SELECT uuid, name, parent FROM taxonomy_category WHERE taxonomy = ? ORDER BY rank`,
    )
    .all(taxonomyId) as {
    uuid: string;
    name: string;
    parent: string | null;
  }[];

  // All assignments for this taxonomy
  const assignments = sqlite
    .prepare(
      `SELECT item, item_type, category, weight FROM taxonomy_assignment WHERE taxonomy = ?`,
    )
    .all(taxonomyId) as {
    item: string;
    item_type: string | null;
    category: string;
    weight: number | null;
  }[];

  // Build item -> market value map
  const mvByItemId = new Map<string, Decimal>();
  for (const s of statement.securities) mvByItemId.set(s.securityId, new Decimal(s.marketValue));
  for (const a of statement.depositAccounts) mvByItemId.set(a.accountId, new Decimal(a.balance));

  // Resolve names + retired status + logos
  const refData = getReferenceData(sqlite);
  const secNameMap = new Map(refData.securities.map((s) => [s.uuid, s.name]));
  const retiredSecIds = new Set(refData.securities.filter((s) => s.isRetired === 1).map((s) => s.uuid));
  const acctNameMap = new Map(refData.accounts.map((a) => [a.uuid, a.name]));
  const logoMap = new Map<string, string>([
    ...refData.secLogoMap,
    ...refData.acctLogoMap,
  ]);

  // Determine non-leaf nodes
  const parentIds = new Set(categories.map((c) => c.parent).filter(Boolean) as string[]);

  // Build leaf-level category totals + per-category security details
  const leafCategoryMV = new Map<string, Decimal>();
  const categorySecurities = new Map<string, SecurityDetail[]>();
  for (const a of assignments) {
    const itemMV = mvByItemId.get(a.item) ?? new Decimal(0);
    const weight = a.weight != null ? new Decimal(a.weight).div(10000) : new Decimal(1);
    const allocated = itemMV.times(weight);
    leafCategoryMV.set(
      a.category,
      (leafCategoryMV.get(a.category) ?? new Decimal(0)).plus(allocated),
    );
    const isAccount = a.item_type === 'account';
    const name = isAccount
      ? (acctNameMap.get(a.item) ?? a.item)
      : (secNameMap.get(a.item) ?? a.item);
    const detail: SecurityDetail = {
      securityId: a.item,
      name,
      weight: a.weight ?? 10000,
      marketValue: allocated.toString(),
      isAccount,
      isRetired: !isAccount && retiredSecIds.has(a.item),
      logoUrl: logoMap.get(a.item) ?? null,
    };
    if (!categorySecurities.has(a.category)) categorySecurities.set(a.category, []);
    categorySecurities.get(a.category)!.push(detail);
  }

  // Aggregate child MVs up to parent categories (post-order DFS)
  const catIds = new Set(categories.map((c) => c.uuid));
  const childrenOf = new Map<string, string[]>();
  for (const cat of categories) {
    if (cat.parent && catIds.has(cat.parent)) {
      if (!childrenOf.has(cat.parent)) childrenOf.set(cat.parent, []);
      childrenOf.get(cat.parent)!.push(cat.uuid);
    }
  }

  const categoryMV = new Map<string, Decimal>();
  const visited = new Set<string>();

  function sumSubtree(uuid: string): Decimal {
    if (visited.has(uuid)) return categoryMV.get(uuid) ?? new Decimal(0);
    visited.add(uuid);
    let total = leafCategoryMV.get(uuid) ?? new Decimal(0);
    for (const childId of childrenOf.get(uuid) ?? []) {
      total = total.plus(sumSubtree(childId));
    }
    categoryMV.set(uuid, total);
    return total;
  }

  for (const cat of categories) {
    if (!cat.parent || !catIds.has(cat.parent)) sumSubtree(cat.uuid);
  }

  // Classified total: sum MV of direct children of root
  const classifiedTotal = categories
    .filter((cat) => cat.parent === rootCategoryUuid && cat.uuid !== rootCategoryUuid)
    .reduce((sum, cat) => sum.plus(categoryMV.get(cat.uuid) ?? new Decimal(0)), new Decimal(0));

  // Build depth map (0 = direct child of root)
  const depthMap = new Map<string, number>();
  function computeDepth(uuid: string): number {
    if (depthMap.has(uuid)) return depthMap.get(uuid)!;
    const cat = categories.find((c) => c.uuid === uuid);
    if (!cat?.parent || cat.parent === rootCategoryUuid) {
      depthMap.set(uuid, 0);
      return 0;
    }
    const d = computeDepth(cat.parent) + 1;
    depthMap.set(uuid, d);
    return d;
  }
  categories.forEach((c) => computeDepth(c.uuid));

  const items = categories
    .filter((cat) => cat.uuid !== rootCategoryUuid)
    .map((cat) => {
      const mv = categoryMV.get(cat.uuid) ?? new Decimal(0);
      return {
        categoryId: cat.uuid,
        name: cat.name,
        parentId: cat.parent === rootCategoryUuid ? null : cat.parent,
        marketValue: mv.toString(),
        percentage: classifiedTotal.gt(0) ? mv.div(classifiedTotal).mul(100).toFixed(2) : '0',
        depth: depthMap.get(cat.uuid) ?? 0,
        isLeaf: !parentIds.has(cat.uuid),
        securities: (categorySecurities.get(cat.uuid) ?? []).map(sec => ({
          ...sec,
          percentage: classifiedTotal.gt(0)
            ? new Decimal(sec.marketValue).div(classifiedTotal).mul(100).toFixed(2)
            : '0',
        })),
      };
    });

  return { date, taxonomyId, items, totalMarketValue: classifiedTotal.toString() };
}

// ─── Payments ───────────────────────────────────────────────

interface PaymentRow {
  uuid: string;
  type: string;
  date: string;
  amount: number | null;
  taxes: number | null;
  fees: number | null;
  currency: string | null;
  security: string | null;
  account: string | null;
  security_name: string | null;
  account_name: string | null;
}

interface MappedPayment {
  id: string;
  type: 'DIVIDEND' | 'INTEREST';
  date: string;
  grossAmount: string;
  netAmount: string;
  taxes: string;
  fees: string;
  currencyCode: string | null;
  securityId: string | null;
  securityName: string | null;
  accountId: string | null;
  accountName: string | null;
}

interface PaymentGroupEntry {
  bucket: string;
  totalGross: Decimal;
  totalNet: Decimal;
  count: number;
  payments: MappedPayment[];
}

function mapPaymentRow(row: PaymentRow): MappedPayment {
  const net = convertAmountFromDb(row.amount);
  const tax = convertAmountFromDb(row.taxes);
  const fee = convertAmountFromDb(row.fees);
  const gross = net.plus(tax).plus(fee);

  const isCharge = row.type === 'INTEREST_CHARGE';
  const sign = isCharge ? new Decimal(-1) : new Decimal(1);

  const normalizedType: 'DIVIDEND' | 'INTEREST' =
    row.type === 'INTEREST' || row.type === 'INTEREST_CHARGE' ? 'INTEREST' : 'DIVIDEND';

  return {
    id: row.uuid,
    type: normalizedType,
    date: row.date ? row.date.slice(0, 10) : row.date,
    grossAmount: gross.times(sign).toString(),
    netAmount: net.times(sign).toString(),
    taxes: tax.times(sign).toString(),
    fees: fee.times(sign).toString(),
    currencyCode: row.currency,
    securityId: row.security,
    securityName: row.security_name,
    accountId: row.account,
    accountName: row.account_name,
  };
}

function bucketKey(date: string, groupBy: string): string {
  const [y, m] = date.split('-');
  if (groupBy === 'year') return y;
  if (groupBy === 'quarter') return `${y}-Q${Math.ceil(parseInt(m, 10) / 3)}`; // native-ok
  return `${y}-${m}`;
}

function serializeGroups(map: Map<string, PaymentGroupEntry>) {
  return [...map.values()].map((g) => ({
    bucket: g.bucket,
    totalGross: g.totalGross.toString(),
    totalNet: g.totalNet.toString(),
    count: g.count,
    payments: g.payments,
  }));
}

export interface PaymentsResult {
  periodStart: string;
  periodEnd: string;
  groupBy: string;
  totals: {
    dividendsGross: string;
    dividendsNet: string;
    interestGross: string;
    interestNet: string;
    earningsGross: string;
    earningsNet: string;
  };
  dividendGroups: ReturnType<typeof serializeGroups>;
  interestGroups: ReturnType<typeof serializeGroups>;
  combinedGroups: ReturnType<typeof serializeGroups>;
}

export function getPayments(
  sqlite: Database.Database,
  periodStart: string,
  periodEnd: string,
  groupBy: 'month' | 'quarter' | 'year',
): PaymentsResult {
  const rows = sqlite
    .prepare(
      `SELECT x.uuid, x.type, x.date, x.amount, x.taxes, x.fees,
              x.currency, x.security, x.account,
              s.name AS security_name,
              a.name AS account_name
       FROM xact x
       LEFT JOIN security s ON s.uuid = x.security
       LEFT JOIN account a ON a.uuid = x.account
       WHERE x.type IN ('DIVIDEND', 'DIVIDENDS', 'INTEREST', 'INTEREST_CHARGE')
         AND x.date BETWEEN ? AND ?
       ORDER BY x.date ASC`,
    )
    .all(periodStart, periodEnd) as PaymentRow[];

  const payments = rows.map(mapPaymentRow);

  let dividendsGross = new Decimal(0);
  let dividendsNet = new Decimal(0);
  let interestGross = new Decimal(0);
  let interestNet = new Decimal(0);

  for (const p of payments) {
    const gross = new Decimal(p.grossAmount);
    const net = new Decimal(p.netAmount);
    if (p.type === 'DIVIDEND') {
      dividendsGross = dividendsGross.plus(gross);
      dividendsNet = dividendsNet.plus(net);
    } else {
      interestGross = interestGross.plus(gross);
      interestNet = interestNet.plus(net);
    }
  }

  const dividendMap = new Map<string, PaymentGroupEntry>();
  const interestMap = new Map<string, PaymentGroupEntry>();
  const combinedMap = new Map<string, PaymentGroupEntry>();

  for (const p of payments) {
    const bucket = bucketKey(p.date, groupBy);
    const gross = new Decimal(p.grossAmount);
    const net = new Decimal(p.netAmount);

    if (!combinedMap.has(bucket)) combinedMap.set(bucket, { bucket, totalGross: new Decimal(0), totalNet: new Decimal(0), count: 0, payments: [] });
    const combined = combinedMap.get(bucket)!;
    combined.totalGross = combined.totalGross.plus(gross);
    combined.totalNet = combined.totalNet.plus(net);
    combined.count++;
    combined.payments.push(p);

    const targetMap = p.type === 'DIVIDEND' ? dividendMap : interestMap;
    if (!targetMap.has(bucket)) targetMap.set(bucket, { bucket, totalGross: new Decimal(0), totalNet: new Decimal(0), count: 0, payments: [] });
    const entry = targetMap.get(bucket)!;
    entry.totalGross = entry.totalGross.plus(gross);
    entry.totalNet = entry.totalNet.plus(net);
    entry.count++;
    entry.payments.push(p);
  }

  return {
    periodStart,
    periodEnd,
    groupBy,
    totals: {
      dividendsGross: dividendsGross.toString(),
      dividendsNet: dividendsNet.toString(),
      interestGross: interestGross.toString(),
      interestNet: interestNet.toString(),
      earningsGross: dividendsGross.plus(interestGross).toString(),
      earningsNet: dividendsNet.plus(interestNet).toString(),
    },
    dividendGroups: serializeGroups(dividendMap),
    interestGroups: serializeGroups(interestMap),
    combinedGroups: serializeGroups(combinedMap),
  };
}

// ─── Breakdown ──────────────────────────────────────────────

function buildBucketCondition(groupBy: 'month' | 'quarter' | 'year'): string {
  if (groupBy === 'year') return "strftime('%Y', x.date) = ?";
  if (groupBy === 'quarter')
    return "(strftime('%Y', x.date) || '-Q' || ((CAST(strftime('%m', x.date) AS INT) + 2) / 3)) = ?";
  return "strftime('%Y-%m', x.date) = ?";
}

export interface BreakdownResult {
  bucket: string;
  type: string;
  items: {
    id: string;
    name: string;
    grossAmount: string;
    netAmount: string;
    taxes: string;
    fees: string;
    count: number;
    currencyCode: string | null;
  }[];
  totalGross: string;
  totalNet: string;
}

export function getPaymentBreakdown(
  sqlite: Database.Database,
  periodStart: string,
  periodEnd: string,
  bucket: string,
  groupBy: 'month' | 'quarter' | 'year',
  type: 'DIVIDEND' | 'INTEREST',
): BreakdownResult {
  const bucketCondition = buildBucketCondition(groupBy);

  type RawBreakdownRow = {
    id: string;
    name: string;
    total_amount: number;
    total_taxes: number;
    total_fees: number;
    cnt: number;
    currency: string | null;
  };

  let rows: RawBreakdownRow[];

  if (type === 'DIVIDEND') {
    rows = sqlite
      .prepare(
        `SELECT
           COALESCE(s.uuid, x.security, '') AS id,
           COALESCE(s.name, '(unknown)') AS name,
           COALESCE(SUM(x.amount), 0) AS total_amount,
           SUM(COALESCE(x.taxes, 0)) AS total_taxes,
           SUM(COALESCE(x.fees, 0)) AS total_fees,
           COUNT(*) AS cnt,
           MAX(x.currency) AS currency
         FROM xact x
         LEFT JOIN security s ON s.uuid = x.security
         WHERE x.type IN ('DIVIDEND', 'DIVIDENDS')
           AND x.date BETWEEN ? AND ?
           AND ${bucketCondition}
         GROUP BY x.security
         ORDER BY total_amount DESC`,
      )
      .all(periodStart, periodEnd, bucket) as RawBreakdownRow[];
  } else {
    rows = sqlite
      .prepare(
        `SELECT
           COALESCE(a.uuid, x.account, '') AS id,
           COALESCE(a.name, '(unknown)') AS name,
           COALESCE(SUM(CASE WHEN x.type = 'INTEREST_CHARGE' THEN -x.amount ELSE x.amount END), 0) AS total_amount,
           SUM(COALESCE(CASE WHEN x.type = 'INTEREST_CHARGE' THEN -x.taxes ELSE x.taxes END, 0)) AS total_taxes,
           SUM(COALESCE(CASE WHEN x.type = 'INTEREST_CHARGE' THEN -x.fees ELSE x.fees END, 0)) AS total_fees,
           COUNT(*) AS cnt,
           MAX(x.currency) AS currency
         FROM xact x
         LEFT JOIN account a ON a.uuid = x.account
         WHERE x.type IN ('INTEREST', 'INTEREST_CHARGE')
           AND x.date BETWEEN ? AND ?
           AND ${bucketCondition}
         GROUP BY x.account
         ORDER BY total_amount DESC`,
      )
      .all(periodStart, periodEnd, bucket) as RawBreakdownRow[];
  }

  let totalGross = new Decimal(0);
  let totalNet = new Decimal(0);

  const items = rows.map((row) => {
    // DB stores xact.amount as net settlement; reconstruct gross = net + taxes + fees
    const net = convertAmountFromDb(row.total_amount);
    const taxes = convertAmountFromDb(row.total_taxes);
    const fees = convertAmountFromDb(row.total_fees);
    const gross = net.plus(taxes).plus(fees);
    totalGross = totalGross.plus(gross);
    totalNet = totalNet.plus(net);
    return {
      id: row.id,
      name: row.name,
      grossAmount: gross.toString(),
      netAmount: net.toString(),
      taxes: taxes.toString(),
      fees: fees.toString(),
      count: row.cnt,
      currencyCode: row.currency ?? null,
    };
  });

  return {
    bucket,
    type,
    items,
    totalGross: totalGross.toString(),
    totalNet: totalNet.toString(),
  };
}
