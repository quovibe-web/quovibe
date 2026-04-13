// Response types matching API JSON output.
// All numeric fields are strings (Decimal.toString()).

import type { CalculationBreakdownResponse } from '@quovibe/shared';
// Alias kept for backward compatibility — all existing importers of PortfolioCalcResponse
// continue to work without changes. CalculationBreakdownResponse is the canonical type.
export type PortfolioCalcResponse = CalculationBreakdownResponse;

export interface SecurityPerfResponse {
  securityId: string;
  ttwror: string;
  ttwrorPa: string;
  irr: string | null;
  irrConverged: boolean;
  mvb: string;
  mve: string;
  purchaseValue: string;
  realizedGain: string;
  unrealizedGain: string;
  foreignCurrencyGains: string;
  fees: string;
  taxes: string;
  dividends: string;
  interest: string;
  shares: string;
}

export interface MoverEntry {
  securityId: string;
  name: string;
  ttwror: string;
  sparkline: Array<{ date: string; cumR: string }>;
}

export interface MoversResponse {
  periodStart: string;
  periodEnd: string;
  top: MoverEntry[];
  bottom: MoverEntry[];
}

export interface StatementSecurityEntry {
  securityId: string;
  name: string;
  shares: string;
  pricePerShare: string;
  marketValue: string;
  currency: string;
}

export interface StatementAccountEntry {
  accountId: string;
  name: string;
  balance: string;
  currency: string;
}

export interface StatementOfAssetsResponse {
  date: string;
  securities: StatementSecurityEntry[];
  depositAccounts: StatementAccountEntry[];
  totals: {
    marketValue: string;
    securityValue: string;
    cashValue: string;
    cashByCurrency: Array<{ currency: string; value: string }>;
  };
}

export interface HoldingsItem {
  securityId: string;
  name: string;
  marketValue: string;
  percentage: string;
  color?: string | null;
}

export interface HoldingsResponse {
  date: string;
  items: HoldingsItem[];
  totalMarketValue: string;
}

export interface Payment {
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

export interface PaymentGroup {
  bucket: string;
  totalGross: string;
  totalNet: string;
  count: number;
  payments: Payment[];
}

export interface PaymentsResponse {
  periodStart: string;
  periodEnd: string;
  groupBy: 'month' | 'quarter' | 'year';
  totals: {
    dividendsGross: string;
    dividendsNet: string;
    interestGross: string;
    interestNet: string;
    earningsGross: string;
    earningsNet: string;
  };
  dividendGroups: PaymentGroup[];
  interestGroups: PaymentGroup[];
  combinedGroups: PaymentGroup[];
}

export interface ChartPointResponse {
  date: string;
  marketValue: string;
  transfersAccumulated: string;
  ttwrorCumulative: string;
  delta: string;
  drawdown: string;
}

export interface SecurityListItem {
  id: string;
  name: string;
  isin: string | null;
  ticker: string | null;
  currency: string;
  isRetired: boolean;
  instrumentType?: string | null;
  latestPrice?: string | null;
  latestDate?: string | null;
  logoUrl?: string | null;
  shares?: string;
}

export interface AttributeTypeItem {
  id: string;
  name: string;
  columnLabel: string | null;
  type: string;
  converterClass: string;
}

export interface SecurityAttribute {
  typeId: string;
  typeName: string;
  value: string;
}

export interface TaxonomyAssignment {
  categoryId: string;
  taxonomyId: string;
  weight: number | null;
}

export interface SecurityDetailResponse extends SecurityListItem {
  wkn: string | null;
  note: string | null;
  calendar: string | null;
  latestFeedUrl: string | null;
  feedUrl: string | null;
  feed: string | null;
  latestFeed: string | null;
  feedTickerSymbol: string | null;
  feedProperties: Record<string, string>;
  prices: Array<{ date: string; value: string }>;
  attributes: SecurityAttribute[];
  taxonomyAssignments: TaxonomyAssignment[];
}

export interface FetchAllResult {
  results: { securityId: string; name: string; fetched: number; error?: string }[];
  totalFetched: number;
  totalErrors: number;
}

export interface TestFetchResponse {
  prices: Array<{ date: string; close: string }>;
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  error?: string | null;
}

export interface AccountListItem {
  id: string;
  name: string;
  type: 'portfolio' | 'account';
  // Resolved by API: for portfolios this is the referenceAccount's currency (never the portfolio's own)
  currency: string | null;
  balance: string;
  isRetired: boolean;
  referenceAccountId?: string | null;
  transactionCount: number;
  logoUrl?: string | null;
}

export interface TransactionUnit {
  type: string;
  amount: string | null;
  currency?: string | null;
  forexAmount?: number | null;
  forexCurrency?: string | null;
  exchangeRate?: string | null;
}

export interface TransactionDetail extends TransactionListItem {
  fees: number;
  taxes: number;
  source?: string | null;
}

export interface TransactionListItem {
  uuid: string;
  type: string;
  date: string;
  amount: string | null;
  shares: string | null;
  note: string | null;
  securityId: string | null;
  security?: string | null;
  securityName?: string | null;
  accountName?: string | null;
  account: string | null;
  currencyCode: string | null;
  crossAccountId?: string | null;
  direction?: 'inbound' | 'outbound' | null;
  units?: TransactionUnit[];
}

export interface PortfolioResponse {
  config: Record<string, string | null>;
  empty: boolean;
}

export interface TaxonomyListItem {
  id: string;
  name: string;
}

export interface AssetAllocationSecurity {
  securityId: string;
  name: string;
  weight: number;      // basis points 0-10000
  marketValue: string; // weighted MV
  percentage: string;  // % of classified portfolio total
  isAccount: boolean;
  isRetired: boolean;
  logoUrl?: string | null;
}

export interface AssetAllocationItem {
  categoryId: string;
  name: string;
  parentId: string | null;
  marketValue: string;
  percentage: string;
  depth: number;
  isLeaf: boolean;
  securities: AssetAllocationSecurity[];
}

export interface AssetAllocationResponse {
  date: string;
  taxonomyId: string;
  items: AssetAllocationItem[];
  totalMarketValue: string;
}

export interface ReturnsHeatmapResponse {
  monthly: Array<{ year: number; month: number; value: string }>;
  yearly: Array<{ year: number; value: string }>;
}

export interface TaxonomyTreeCategory {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
  weight: number | null;
  children: TaxonomyTreeCategory[];
  assignments: Array<{ assignmentId: number; itemId: string; itemType: string; name: string | null; weight: number | null }>;
}

export interface TaxonomyTreeResponse {
  id: string;
  name: string;
  rootId: string | null;
  categories: TaxonomyTreeCategory[];
}

export interface TaxonomySliceChartPoint {
  date: string;
  marketValue: string;
  ttwrorCumulative: string;
}

export interface SecurityEventItem {
  id: string;
  securityId: string;
  type: string;
  date: string;
  details: string;
}

export interface TaxonomySliceResponse {
  categoryId: string;
  categoryName: string;
  color: string | null;
  ttwror: string;
  ttwrorPa: string;
  irr: string | null;
  mvb: string;
  mve: string;
  absoluteGain: string;
  fees: string;
  taxes: string;
  dividends: string;
  interest: string;
  chartData: TaxonomySliceChartPoint[];
}

// ─── Rebalancing ─────────────────────────────────────────────────────────────

export interface RebalancingSecurity {
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
  logoUrl?: string | null;
}

export interface RebalancingCategory {
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
  securities: RebalancingSecurity[];
}

export interface RebalancingResponse {
  taxonomyId: string;
  totalPortfolioValue: string;
  categories: RebalancingCategory[];
}

// ─── Security Search / Wizard ─────────────────────────────────────────────────
// Canonical types from @quovibe/shared; re-exported for backward compatibility.

export type { SearchResult, PreviewPrice, PreviewPricesResponse } from '@quovibe/shared';

export interface AccountHoldingItem {
  securityId: string;
  securityName: string;
  isin: string | null;
  shares: string;
  avgCost: string;
  currentPrice: string;
  value: string;
  profitLoss: string;
  returnPct: string;
}

export interface AccountHoldingsResponse {
  holdings: AccountHoldingItem[];
  totalValue: string;
}

export interface BrokerageUnit {
  portfolio: AccountListItem;
  deposit: AccountListItem | null;
  holdings: AccountHoldingsResponse | null;
}
