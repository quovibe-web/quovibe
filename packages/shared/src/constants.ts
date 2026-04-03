import { TransactionType } from './enums';

/**
 * Transaction types that generate cashflows at the portfolio level.
 * Used by the engine to build the portfolio-level cashflow series for TTWROR/IRR.
 */
export const PORTFOLIO_CASHFLOW_TYPES = [
  TransactionType.DEPOSIT,
  TransactionType.REMOVAL,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.DELIVERY_OUTBOUND,
] as const;

/**
 * Transaction types that generate cashflows at the individual security level.
 * Used by the engine to build the per-security cashflow series for TTWROR/IRR.
 */
export const SECURITY_CASHFLOW_TYPES = [
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.DIVIDEND,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.DELIVERY_OUTBOUND,
] as const;
