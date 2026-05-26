import Decimal from 'decimal.js';
import { TransactionType, TransactionWithUnits } from '@quovibe/shared';
import { getGrossAmount } from '@quovibe/engine';

interface WithTransferDirection {
  transferDirection?: 'IN' | 'OUT';
  accountId: string;
}

interface InternalLot {
  shares: Decimal;
  pricePerShare: Decimal;
  date: string; // original acquisition date — preserves FIFO order across transfers
}

/**
 * PP-parity pre-processor for SECURITY_TRANSFER pairs.
 *
 * Walks `secTxs` (all rows for a single security, already projected to
 * security currency) in chronological order, maintaining a per-securities-
 * account FIFO lot ledger. At each transfer pair:
 *   - OUTBOUND leg: FIFO-consumes source lots; records carrying cost.
 *   - INBOUND leg: inherits source lots (one row per sub-lot); pushes them
 *     onto the destination account's ledger.
 *
 * Emitted rows:
 *   - SECURITY_TRANSFER_INBOUND  — type rewritten; `amount` = inherited
 *     carrying cost; `shares` = lot's raw share count (× 10^8).
 *   - SECURITY_TRANSFER_OUTBOUND — type rewritten; `amount` = total
 *     carrying cost of consumed lots.
 *   - All other types pass through unchanged.
 *
 * Idempotent: rows already typed SECURITY_TRANSFER_INBOUND / _OUTBOUND
 * are passed through unchanged.
 */
export function inheritTransferCostBasis(
  secTxs: TransactionWithUnits[],
): TransactionWithUnits[] {
  // Sort: non-transfer rows first within a date (lot ledger up-to-date
  // before any transfer applies). Among transfers: OUT before IN.
  const sorted = [...secTxs].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const aIsTransfer = a.type === TransactionType.SECURITY_TRANSFER;
    const bIsTransfer = b.type === TransactionType.SECURITY_TRANSFER;
    if (aIsTransfer !== bIsTransfer) return aIsTransfer ? 1 : -1;
    const aDir = (a as unknown as WithTransferDirection).transferDirection;
    const bDir = (b as unknown as WithTransferDirection).transferDirection;
    if (aDir === 'OUT' && bDir === 'IN') return -1;
    if (aDir === 'IN' && bDir === 'OUT') return 1;
    return 0;
  });

  const lotsByAccount = new Map<string, InternalLot[]>();

  function getLots(accountId: string): InternalLot[] {
    let lots = lotsByAccount.get(accountId);
    if (!lots) { lots = []; lotsByAccount.set(accountId, lots); }
    return lots;
  }

  function pushLot(accountId: string, lot: InternalLot): void {
    getLots(accountId).push(lot);
  }

  function consumeLots(accountId: string, shares: Decimal): InternalLot[] {
    const lots = getLots(accountId);
    let remaining = shares;
    const consumed: InternalLot[] = [];
    while (remaining.gt(0) && lots.length > 0) {
      const lot = lots[0];
      const take = Decimal.min(remaining, lot.shares);
      consumed.push({ shares: take, pricePerShare: lot.pricePerShare, date: lot.date });
      lot.shares = lot.shares.minus(take);
      if (lot.shares.isZero()) lots.shift();
      remaining = remaining.minus(take);
    }
    return consumed;
  }

  // Pending outbound lots queued by date+shares key; dequeued FIFO by
  // the matching inbound. Queue handles multiple same-date transfers of
  // the same share count (separate source accounts) without key collision.
  const pendingOutbound = new Map<string, InternalLot[][]>();

  function enqueue(date: string, sharesRaw: number, lots: InternalLot[]): void {
    const key = `${date}|${sharesRaw}`;
    const q = pendingOutbound.get(key) ?? [];
    q.push(lots);
    pendingOutbound.set(key, q);
  }

  function dequeue(date: string, sharesRaw: number): InternalLot[] {
    const key = `${date}|${sharesRaw}`;
    const q = pendingOutbound.get(key);
    if (!q || q.length === 0) return [];
    const lots = q.shift()!;
    if (q.length === 0) pendingOutbound.delete(key);
    return lots;
  }

  const result: TransactionWithUnits[] = [];

  for (const tx of sorted) {
    const withDir = tx as unknown as WithTransferDirection;
    const accountId = withDir.accountId;
    const sharesRaw = tx.shares ?? 0;
    const shares = new Decimal(sharesRaw).div(1e8);

    switch (tx.type) {
      case TransactionType.BUY:
      case TransactionType.DELIVERY_INBOUND: {
        if (shares.gt(0)) {
          const gross = getGrossAmount(tx);
          const pricePerShare = shares.isZero() ? new Decimal(0) : gross.div(shares);
          pushLot(accountId, { shares, pricePerShare, date: tx.date });
        }
        result.push(tx);
        break;
      }
      case TransactionType.SELL:
      case TransactionType.DELIVERY_OUTBOUND: {
        if (shares.gt(0)) consumeLots(accountId, shares);
        result.push(tx);
        break;
      }
      case TransactionType.SECURITY_TRANSFER: {
        const direction = withDir.transferDirection;

        if (direction === 'OUT') {
          const consumed = consumeLots(accountId, shares);
          const carryingCost = consumed.reduce(
            (sum, lot) => sum.plus(lot.shares.times(lot.pricePerShare)),
            new Decimal(0),
          );
          enqueue(tx.date, sharesRaw, consumed);
          result.push({
            ...tx,
            type: TransactionType.SECURITY_TRANSFER_OUTBOUND,
            amount: carryingCost.toNumber(),
          });
        } else if (direction === 'IN') {
          const inheritedLots = dequeue(tx.date, sharesRaw);

          if (inheritedLots.length === 0) {
            // No matching outbound in scope (destination-only view or unpaired data).
            // Emit with zero cost so shares are counted correctly without crashing.
            result.push({ ...tx, type: TransactionType.SECURITY_TRANSFER_INBOUND });
          } else {
            for (const lot of inheritedLots) {
              const lotCost = lot.shares.times(lot.pricePerShare).toNumber();
              const lotSharesRaw = lot.shares.times(1e8).toNumber();
              result.push({
                ...tx,
                type: TransactionType.SECURITY_TRANSFER_INBOUND,
                date: lot.date, // original acquisition date — preserves FIFO lot order in engine
                shares: lotSharesRaw,
                amount: lotCost,
              });
              pushLot(accountId, lot);
            }
          }
        } else {
          // Direction unknown — pass through without modification.
          result.push(tx);
        }
        break;
      }
      default:
        result.push(tx);
    }
  }

  return result;
}
