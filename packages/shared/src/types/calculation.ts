// Per-item types

export interface CapitalGainItem {
  securityId: string;
  name: string;
  isin?: string;
  unrealizedGain: string;
  foreignCurrencyGains: string;
  initialValue: string;
  finalValue: string;
}

export interface RealizedGainItem {
  securityId: string;
  name: string;
  isin?: string;
  realizedGain: string;
  proceeds: string;
  costAtPeriodStart: string;
}

export interface DividendItem {
  securityId: string;
  name: string;
  isin?: string;
  dividends: string;
}

export interface FeeItem {
  securityId?: string;       // undefined = standalone fee tx
  name: string;              // security name OR account name for standalone
  fees: string;
}

export interface TaxItem {
  securityId?: string;
  name: string;
  taxes: string;
}

export interface CashCurrencyGainItem {
  accountId: string;
  name: string;
  currency: string;
  gain: string;
}

export interface PntItem {
  type: 'DEPOSIT' | 'REMOVAL' | 'DELIVERY_INBOUND' | 'DELIVERY_OUTBOUND';
  // Uses TransactionType enum values (uppercase). Frontend maps to display labels via i18n.
  accountId: string;
  name: string;              // account name
  amount: string;
  date: string;              // YYYY-MM-DD pure date (individual transaction, not grouped)
}

// Breakdown category types
//
// NOTE on capitalGains vs realizedGains:
// capitalGains.realized and realizedGains.total contain the same value by design.
// capitalGains groups all sub-totals (unrealized + realized + FX) for the "Capital Gains"
// summary display. realizedGains is a separate row with per-security item detail.
// This mirrors the Calculation panel which shows both a "Capital Gains" aggregate
// and a separate "Realized Capital Gains" expandable row.
export interface CapitalGainsBreakdown {
  unrealized: string;
  realized: string;
  foreignCurrencyGains: string;
  total: string;
  items: CapitalGainItem[];           // unrealized gains per security
}

export interface RealizedGainsBreakdown {
  total: string;                      // === capitalGains.realized
  items: RealizedGainItem[];
}

export interface EarningsBreakdown {
  dividends: string;
  interest: string;
  total: string;
  dividendItems: DividendItem[];
  // NO interestItems — interest is never itemized
}

export interface FeesBreakdown {
  total: string;
  items: FeeItem[];
}

export interface TaxesBreakdown {
  total: string;
  items: TaxItem[];
}

export interface CashCurrencyGainsBreakdown {
  total: string;
  items: CashCurrencyGainItem[];
}

export interface PntBreakdown {
  deposits: string;               // existing sub-total (preserved)
  removals: string;               // existing sub-total (preserved)
  deliveryInbound: string;        // existing sub-total (preserved)
  deliveryOutbound: string;       // existing sub-total (preserved)
  taxes: string;                  // existing sub-total (preserved)
  total: string;
  items: PntItem[];               // NEW: individual transactions
}

// Broker-style open-position PnL (since-inception, unrealized only on currently-held shares).
// Matches the "Guadagno/Perdita" convention used by Italian retail brokers (Directa, Fineco…):
//   PMC = moving-average buy cost (buy fees capitalized), rolled by partial sells
//   openPositionPnL = Σ(currentPrice − PMC) × heldShares   (per security, across portfolio)
//   percentage      = openPositionPnL / Σ(PMC × heldShares)
// Both Moving-Average (default) and FIFO decompositions are provided.
// Fully closed positions contribute zero. Dividends, interest, realized gains are excluded.
export interface OpenPositionPnLBreakdown {
  // Moving-average / PMC convention — matches Italian broker "Guadagno/Perdita"
  value: string;            // total unrealized PnL (€, or base currency)
  percentage: string;       // value / cost  (ratio: 0.0842 = 8.42%)
  cost: string;             // Σ PMC × heldShares (cost basis of currently-held shares)
  marketValue: string;      // Σ currentPrice × heldShares
  // FIFO alternative — same concept, different cost-basis convention
  fifo: {
    value: string;          // unrealized PnL under FIFO lot matching
    percentage: string;     // fifo.value / fifo.cost
    cost: string;           // FIFO cost of remaining lots
  };
}

// Top-level response
// Replaces the existing PortfolioCalcResponse. This is a coordinated structural
// change: fees/taxes/cashCurrencyGains change from string → object with total+items.
// capitalGains gains a total field and items array. realizedGains is a new top-level
// category (realizedGains.total === capitalGains.realized by design).
// The only frontend consumer (useCalculation / Calculation.tsx) is updated simultaneously.
export interface CalculationBreakdownResponse {
  initialValue: string;
  capitalGains: CapitalGainsBreakdown;
  realizedGains: RealizedGainsBreakdown;
  earnings: EarningsBreakdown;
  fees: FeesBreakdown;
  taxes: TaxesBreakdown;
  cashCurrencyGains: CashCurrencyGainsBreakdown;
  performanceNeutralTransfers: PntBreakdown;
  finalValue: string;
  ttwror: string;
  ttwrorPa: string;
  irr: string | null;
  irrConverged: boolean;
  irrError: string | null;
  delta: string;
  deltaValue: string;
  absoluteChange: string;
  absolutePerformance: string;
  absolutePerformancePct: string;
  maxDrawdown: string;
  currentDrawdown: string;
  maxDrawdownPeakDate: string | null;
  maxDrawdownTroughDate: string | null;
  maxDrawdownDuration: number;
  volatility: string;
  semivariance: string;
  sharpeRatio: string | null;  // null when volatility = 0 or IRR did not converge
  // lastDay* fields are added by the route handler (second getPortfolioCalc call
  // with includeItems=false), not by the service function itself.
  lastDayAbsoluteChange: string;
  lastDayDeltaValue: string;
  lastDayDelta: string;
  lastDayAbsolutePerformance: string;
  openPositionPnL: OpenPositionPnLBreakdown;
}
