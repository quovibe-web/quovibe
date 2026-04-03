import type BetterSqlite3 from 'better-sqlite3';
import Decimal from 'decimal.js';
import { getCachedStatement, getCachedReferenceData } from './statement-cache';

interface SecurityDetail {
  securityId: string;
  name: string;
  weight: number;
  rebalancingIncluded: boolean;
  actualValue: Decimal;
  currentPrice: string;
  currency: string;
  isAccount: boolean;
  logoUrl: string | null;
}

interface RebalancingCategory {
  categoryId: string;
  name: string;
  parentId: string | null;
  color: string | null;
  depth: number;
  allocation: number;
  actualValue: string;
  targetValue: string;
  deltaValue: string;
  deltaPercent: string;
  allocationSumOk: boolean;
  allocationSum: number;
  securities: {
    securityId: string;
    name: string;
    weight: number;
    rebalancingIncluded: boolean;
    isRetired: boolean;
    actualValue: string;
    rebalanceAmount: string;
    rebalanceShares: string;
    currentPrice: string;
    currency: string;
    logoUrl: string | null;
  }[];
}

export interface RebalancingResult {
  taxonomyId: string;
  totalPortfolioValue: string;
  categories: RebalancingCategory[];
}

export function computeRebalancing(
  sqlite: BetterSqlite3.Database,
  taxonomyId: string,
  date: string,
): RebalancingResult | null {
  // 1. Check taxonomy exists
  const taxonomy = sqlite
    .prepare('SELECT uuid, name, root FROM taxonomy WHERE uuid = ?')
    .get(taxonomyId) as { uuid: string; name: string; root: string | null } | undefined;
  if (!taxonomy) return null;

  const rootCategoryUuid = taxonomy.root ?? null;

  // 2. Fetch all categories
  const categories = sqlite
    .prepare('SELECT uuid, name, parent, color, weight FROM taxonomy_category WHERE taxonomy = ?')
    .all(taxonomyId) as { uuid: string; name: string; parent: string | null; color: string | null; weight: number }[];

  // 3. Fetch assignments
  const assignments = sqlite
    .prepare('SELECT item, item_type, category, weight FROM taxonomy_assignment WHERE taxonomy = ?')
    .all(taxonomyId) as { item: string; item_type: string; category: string; weight: number | null }[];

  // 4. Fetch rebalancing-included flags from taxonomy_data
  const rebalFlagsDetailed = sqlite
    .prepare("SELECT category, name, value FROM taxonomy_data WHERE taxonomy = ? AND name LIKE 'rebalancing-included:%'")
    .all(taxonomyId) as { category: string; name: string; value: string }[];
  const excludedFromRebal = new Map<string, Set<string>>();
  for (const f of rebalFlagsDetailed) {
    const itemUuid = f.name.replace('rebalancing-included:', '');
    if (f.value === 'false') {
      if (!excludedFromRebal.has(f.category)) excludedFromRebal.set(f.category, new Set());
      excludedFromRebal.get(f.category)!.add(itemUuid);
    }
  }

  // Resolve ALL security/account names, retirement status, and logos (cached)
  const refData = getCachedReferenceData(sqlite);
  const secNameMap = new Map(refData.securities.map(s => [s.uuid, s.name]));
  const retiredSecIds = new Set(refData.securities.filter(s => s.isRetired === 1).map(s => s.uuid));
  const acctNameMap = new Map(refData.accounts.map(a => [a.uuid, a.name]));
  const logoMap = new Map<string, string>([
    ...refData.secLogoMap,
    ...refData.acctLogoMap,
  ]);

  // 5. Get statement of assets (market values) — cached
  const statement = getCachedStatement(sqlite, date);
  const totalMV = new Decimal(statement.totals.marketValue);

  const mvByItemId = new Map<string, Decimal>();
  for (const s of statement.securities) mvByItemId.set(s.securityId, new Decimal(s.marketValue));
  for (const a of statement.depositAccounts) mvByItemId.set(a.accountId, new Decimal(a.balance));

  // Security names and prices for rebalancing display
  const securityInfo = new Map<string, { name: string; price: string; currency: string }>();
  for (const s of statement.securities) {
    securityInfo.set(s.securityId, { name: s.name, price: s.pricePerShare ?? '0', currency: s.currency });
  }
  // Account names
  const accountInfo = new Map<string, { name: string }>();
  for (const a of statement.depositAccounts) {
    accountInfo.set(a.accountId, { name: a.name });
  }

  // 6. Build category tree structures
  const catIds = new Set(categories.map(c => c.uuid));
  const catByUuid = new Map(categories.map(c => [c.uuid, c]));
  const childrenOf = new Map<string, string[]>();
  for (const cat of categories) {
    if (cat.parent && catIds.has(cat.parent)) {
      if (!childrenOf.has(cat.parent)) childrenOf.set(cat.parent, []);
      childrenOf.get(cat.parent)!.push(cat.uuid);
    }
  }

  // 7. Leaf-level category actual values from assignments
  const categorySecurities = new Map<string, SecurityDetail[]>();
  const leafCategoryMV = new Map<string, Decimal>();

  for (const a of assignments) {
    const isAccount = a.item_type === 'account';
    const isRetired = !isAccount && retiredSecIds.has(a.item);

    const itemMV = mvByItemId.get(a.item) ?? new Decimal(0);
    const w = a.weight != null ? a.weight : 10000;
    if (w === 0) continue;
    const weightDec = new Decimal(w).div(10000);
    const allocated = itemMV.times(weightDec);

    leafCategoryMV.set(a.category, (leafCategoryMV.get(a.category) ?? new Decimal(0)).plus(allocated));

    const isExcluded = excludedFromRebal.get(a.category)?.has(a.item) ?? false;
    const info = isAccount ? accountInfo.get(a.item) : securityInfo.get(a.item);
    const price = isAccount ? '0' : (securityInfo.get(a.item)?.price ?? '0');

    if (!categorySecurities.has(a.category)) categorySecurities.set(a.category, []);
    categorySecurities.get(a.category)!.push({
      securityId: a.item,
      name: info?.name ?? secNameMap.get(a.item) ?? acctNameMap.get(a.item) ?? a.item,
      weight: w,
      rebalancingIncluded: !isExcluded && !isRetired && (isAccount || new Decimal(price).gt(0)),
      actualValue: allocated,
      currentPrice: price,
      currency: isAccount ? '' : (securityInfo.get(a.item)?.currency ?? ''),
      isAccount,
      logoUrl: logoMap.get(a.item) ?? null,
    });
  }

  // 8. Bottom-up: sum child actual values
  const categoryActualMV = new Map<string, Decimal>();
  const visited = new Set<string>();

  function sumSubtree(uuid: string): Decimal {
    if (visited.has(uuid)) return categoryActualMV.get(uuid) ?? new Decimal(0);
    visited.add(uuid);
    let total = leafCategoryMV.get(uuid) ?? new Decimal(0);
    for (const childId of childrenOf.get(uuid) ?? []) {
      total = total.plus(sumSubtree(childId));
    }
    categoryActualMV.set(uuid, total);
    return total;
  }

  for (const cat of categories) {
    if (!cat.parent || !catIds.has(cat.parent)) sumSubtree(cat.uuid);
  }

  // 9. Top-down: compute target values
  const categoryTargetMV = new Map<string, Decimal>();

  function computeTargets(uuid: string, parentTarget: Decimal) {
    const cat = catByUuid.get(uuid);
    if (!cat) return;
    const allocation = new Decimal(cat.weight).div(10000);
    const target = parentTarget.times(allocation);
    categoryTargetMV.set(uuid, target);

    const directAssignmentActual = leafCategoryMV.get(uuid) ?? new Decimal(0);
    const distributable = target.minus(directAssignmentActual);

    for (const childId of childrenOf.get(uuid) ?? []) {
      computeTargets(childId, distributable);
    }
  }

  for (const cat of categories) {
    const isRoot = rootCategoryUuid && cat.uuid === rootCategoryUuid;
    if (!isRoot && (!cat.parent || cat.parent === rootCategoryUuid)) {
      computeTargets(cat.uuid, totalMV);
    }
  }

  // 10. Build depth map
  const depthMap = new Map<string, number>();
  function computeDepth(uuid: string): number {
    if (depthMap.has(uuid)) return depthMap.get(uuid)!;
    const cat = catByUuid.get(uuid);
    if (!cat?.parent || cat.parent === rootCategoryUuid) {
      depthMap.set(uuid, 0);
      return 0;
    }
    const d = computeDepth(cat.parent) + 1; // native-ok
    depthMap.set(uuid, d);
    return d;
  }
  categories.forEach(c => computeDepth(c.uuid));

  // 11. Compute sibling sums per parent (for allocationSumOk)
  const siblingSum = new Map<string, number>();
  for (const cat of categories) {
    const parent = cat.parent && catIds.has(cat.parent) ? cat.parent : null;
    if (parent) {
      siblingSum.set(parent, (siblingSum.get(parent) ?? 0) + cat.weight); // native-ok
    }
  }

  // 12. Build response
  const result = categories
    .filter(cat => cat.uuid !== rootCategoryUuid)
    .map(cat => {
      const actual = categoryActualMV.get(cat.uuid) ?? new Decimal(0);
      const target = categoryTargetMV.get(cat.uuid) ?? new Decimal(0);
      const delta = target.minus(actual);
      const deltaPercent = target.gt(0) ? actual.div(target).minus(1) : new Decimal(0);

      const parentUuid = cat.parent === rootCategoryUuid ? rootCategoryUuid : cat.parent;
      const allocationSum = parentUuid ? (siblingSum.get(parentUuid) ?? 0) : 0; // native-ok
      const allocationSumOk = allocationSum === 10000; // native-ok

      const secs = categorySecurities.get(cat.uuid) ?? [];
      const includedSecs = secs.filter(s => s.rebalancingIncluded && !s.isAccount);
      const totalWeight = includedSecs.reduce((sum, s) => sum + s.weight, 0); // native-ok

      const securities = secs.map(s => {
        let rebalAmount = new Decimal(0);
        let rebalShares = new Decimal(0);

        if (s.rebalancingIncluded && !s.isAccount) {
          if (totalWeight > 0) {
            rebalAmount = delta.times(new Decimal(s.weight)).div(new Decimal(totalWeight));
          } else if (includedSecs.length > 0) { // native-ok
            rebalAmount = delta.div(includedSecs.length); // native-ok
          }
          const price = new Decimal(s.currentPrice);
          rebalShares = price.gt(0) ? rebalAmount.div(price) : new Decimal(0);
        }

        return {
          securityId: s.securityId,
          name: s.name,
          weight: s.weight,
          rebalancingIncluded: s.rebalancingIncluded,
          isRetired: !s.isAccount && retiredSecIds.has(s.securityId),
          actualValue: s.actualValue.toFixed(2),
          rebalanceAmount: rebalAmount.toFixed(2),
          rebalanceShares: rebalShares.toFixed(4),
          currentPrice: s.currentPrice,
          currency: s.currency,
          logoUrl: s.logoUrl,
        };
      });

      return {
        categoryId: cat.uuid,
        name: cat.name,
        parentId: cat.parent === rootCategoryUuid ? null : cat.parent,
        color: cat.color,
        depth: depthMap.get(cat.uuid) ?? 0, // native-ok
        allocation: cat.weight,
        actualValue: actual.toFixed(2),
        targetValue: target.toFixed(2),
        deltaValue: delta.toFixed(2),
        deltaPercent: deltaPercent.toFixed(4),
        allocationSumOk,
        allocationSum,
        securities,
      };
    });

  return {
    taxonomyId,
    totalPortfolioValue: totalMV.toFixed(2),
    categories: result,
  };
}
