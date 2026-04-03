import {
  ArrowDownLeft, ArrowUpRight, ShoppingCart, Tag,
  Coins, Banknote, Receipt, CircleDollarSign,
  ArrowLeftRight, PackagePlus, PackageMinus, RefreshCw,
  type LucideIcon,
} from 'lucide-react';


/** Icon for each transaction type (used in badges) */
export const TX_TYPE_ICON: Record<string, LucideIcon> = {
  BUY: ShoppingCart,
  SELL: Tag,
  DEPOSIT: ArrowDownLeft,
  REMOVAL: ArrowUpRight,
  DIVIDEND: Coins,
  INTEREST: Banknote,
  INTEREST_CHARGE: Banknote,
  FEES: Receipt,
  FEES_REFUND: Receipt,
  TAXES: CircleDollarSign,
  TAX_REFUND: CircleDollarSign,
  DELIVERY_INBOUND: PackagePlus,
  DELIVERY_OUTBOUND: PackageMinus,
  TRANSFER_BETWEEN_ACCOUNTS: ArrowLeftRight,
  SECURITY_TRANSFER: RefreshCw,
};

/** Types that increase cash on a deposit account (inflow) */
const DEPOSIT_INFLOW_TYPES = new Set([
  'DEPOSIT',
  'DIVIDEND',
  'INTEREST',
  'TAX_REFUND',
  'FEES_REFUND',
]);

/** Types that decrease cash on a deposit account (outflow) */
const DEPOSIT_OUTFLOW_TYPES = new Set([
  'REMOVAL',
  'TAXES',
  'FEES',
  'INTEREST_CHARGE',
]);

/**
 * Maps transaction types to their semantic badge color direction.
 * Does NOT include BUY/SELL (context-dependent) or transfer types (direction-dependent).
 */
const BADGE_COLOR_MAP: Record<string, 'profit' | 'loss'> = {
  DEPOSIT: 'profit',
  DIVIDEND: 'profit',
  INTEREST: 'profit',
  TAX_REFUND: 'profit',
  FEES_REFUND: 'profit',
  DELIVERY_INBOUND: 'profit',
  REMOVAL: 'loss',
  TAXES: 'loss',
  FEES: 'loss',
  INTEREST_CHARGE: 'loss',
  DELIVERY_OUTBOUND: 'loss',
};

const TRANSFER_TYPES = new Set(['TRANSFER_BETWEEN_ACCOUNTS', 'SECURITY_TRANSFER']);

export type BadgeVariant = 'profit' | 'loss' | 'dividend' | 'neutral';

/**
 * Returns the badge variant for a transaction type.
 */
export function getTransactionBadgeVariant(
  type: string,
  accountContext: 'global' | 'deposit' | 'securities' = 'global',
  direction?: 'inbound' | 'outbound' | null,
): BadgeVariant {
  if (type === 'BUY') return accountContext === 'deposit' ? 'loss' : 'profit';
  if (type === 'SELL') return accountContext === 'deposit' ? 'profit' : 'loss';

  if (TRANSFER_TYPES.has(type)) {
    if (direction === 'inbound') return 'profit';
    if (direction === 'outbound') return 'loss';
    return 'neutral';
  }

  if (type === 'DIVIDEND') return 'dividend';

  const mapped = BADGE_COLOR_MAP[type];
  if (mapped === 'profit') return 'profit';
  if (mapped === 'loss') return 'loss';

  return 'neutral';
}

/**
 * Returns the cashflow sign for a transaction amount.
 *
 * Returns:
 *  1 → inflow (show positive, colorize green)
 * -1 → outflow (show negative, colorize red)
 *  0 → absolute (no sign, no colorize — e.g. DELIVERY types on deposit side)
 *
 * @param context - 'deposit' (cash perspective) or 'securities' (shares perspective).
 *   BUY/SELL and DELIVERY signs are flipped between contexts (double-entry).
 */
export function getTransactionCashflowSign(
  type: string,
  direction?: 'inbound' | 'outbound' | null,
  context: 'deposit' | 'securities' = 'deposit',
): 1 | -1 | 0 {
  // BUY/SELL: flip based on context (double-entry)
  if (type === 'BUY') return context === 'deposit' ? -1 : 1;
  if (type === 'SELL') return context === 'deposit' ? 1 : -1;

  // DELIVERY: no cash impact on deposit, but shares move on securities side
  if (type === 'DELIVERY_INBOUND') return context === 'deposit' ? 0 : 1;
  if (type === 'DELIVERY_OUTBOUND') return context === 'deposit' ? 0 : -1;

  // Cash-only types: same sign regardless of context
  if (DEPOSIT_INFLOW_TYPES.has(type)) return 1;
  if (DEPOSIT_OUTFLOW_TYPES.has(type)) return -1;

  // Transfers: direction-based
  if (TRANSFER_TYPES.has(type)) {
    if (direction === 'inbound') return 1;
    if (direction === 'outbound') return -1;
    return 0;
  }

  return 0;
}

/**
 * Returns the i18n label key for a transaction type, handling direction-based variants.
 * Uses the same camelCase conversion as txTypeKey from utils.ts.
 */
export function getTransactionLabelKey(type: string, direction?: 'inbound' | 'outbound' | null): string {
  if (direction === 'inbound' && type === 'TRANSFER_BETWEEN_ACCOUNTS') return 'types.transferInbound';
  if (direction === 'outbound' && type === 'TRANSFER_BETWEEN_ACCOUNTS') return 'types.transferOutbound';
  if (direction === 'inbound' && type === 'SECURITY_TRANSFER') return 'types.securityTransferInbound';
  if (direction === 'outbound' && type === 'SECURITY_TRANSFER') return 'types.securityTransferOutbound';
  const camel = type.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return 'types.' + camel;
}

/** @deprecated Use getTransactionCashflowSign — kept for backward compat */
export function getDepositAmountSign(
  type: string,
  direction?: 'inbound' | 'outbound' | null,
): 1 | -1 | 0 {
  return getTransactionCashflowSign(type, direction);
}
