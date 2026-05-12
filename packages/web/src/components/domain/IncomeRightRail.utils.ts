import type { Payment, PaymentGroup } from '@/api/types';

export type AmountMode = 'gross' | 'net';

export interface PayerEntry {
  name: string;
  total: number;
  share: number;
}

export interface TopPayersResult {
  payers: PayerEntry[];
  cashInterest: { total: number; share: number } | null;
}

export interface ConcentrationResult {
  top3Share: number;
  payerCount: number;
}

export interface ByTypeResult {
  dividend: number;
  interest: number;
  total: number;
  dividendShare: number;
  interestShare: number;
}

function pickAmount(p: Payment, mode: AmountMode): number {
  return parseFloat(mode === 'gross' ? p.grossAmount : p.netAmount);
}

export function extractTopPayers(
  groups: PaymentGroup[],
  mode: AmountMode,
): TopPayersResult {
  const named = new Map<string, number>();
  let cash = 0;
  let grand = 0;
  for (const g of groups) {
    for (const p of g.payments) {
      const v = pickAmount(p, mode);
      if (p.securityName) {
        grand += v;
        named.set(p.securityName, (named.get(p.securityName) ?? 0) + v);
      } else if (p.type === 'INTEREST') {
        grand += v;
        cash += v;
      }
      // else: skip (DIVIDEND with no security — anomalous, ignored like IncomeHero does)
    }
  }
  if (grand <= 0) return { payers: [], cashInterest: null };
  const payers: PayerEntry[] = Array.from(named.entries())
    .map(([name, total]) => ({ name, total, share: total / grand }))
    .sort((a, b) => b.total - a.total);
  const cashInterest = cash > 0 ? { total: cash, share: cash / grand } : null;
  return { payers, cashInterest };
}

export function computeConcentration(payers: PayerEntry[]): ConcentrationResult {
  if (payers.length === 0) return { top3Share: 0, payerCount: 0 };
  const top3 = payers.slice(0, 3).reduce((s, p) => s + p.share, 0);
  return { top3Share: top3, payerCount: payers.length };
}

export function aggregateByType(
  groups: PaymentGroup[],
  mode: AmountMode,
): ByTypeResult {
  let dividend = 0;
  let interest = 0;
  for (const g of groups) {
    for (const p of g.payments) {
      const v = pickAmount(p, mode);
      if (p.type === 'DIVIDEND') dividend += v;
      else if (p.type === 'INTEREST') interest += v;
      // else: unknown future type, skip
    }
  }
  const total = dividend + interest;
  return {
    dividend,
    interest,
    total,
    dividendShare: total > 0 ? dividend / total : 0,
    interestShare: total > 0 ? interest / total : 0,
  };
}
