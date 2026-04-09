# Double-Entry Transaction System

A securities account (`portfolio`) can be associated with **multiple cash accounts** (`type = 'account'`), each tied to a single currency. Multi-currency portfolios need one cash account per currency.

The `referenceAccount` field on a portfolio points to the **default** cash account — a UI/import convenience that determines which cash account is shown as "linked" and used when a transaction does not explicitly specify one. Other cash accounts can still hold transactions for the same portfolio.

## Transaction routing groups

| Group | Types | xact.account row(s) |
|-------|-------|---------------------|
| A — dual entry | BUY, SELL | **2 rows**: securities-side + cash-side |
| B — cash only | DEPOSIT, REMOVAL, DIVIDEND, INTEREST, INTEREST_CHARGE, FEES, FEES_REFUND, TAXES, TAX_REFUND | **1 row**: account=deposit |
| C — shares only | DELIVERY_INBOUND, DELIVERY_OUTBOUND | **1 row**: account=portfolio |
| D — transfer | SECURITY_TRANSFER, TRANSFER_BETWEEN_ACCOUNTS | uses crossAccountId |

## BUY/SELL double-entry structure

A BUY creates **two distinct `xact` records** plus one `xact_cross_entry` record:

**Record 1 — securities side:**
- `xact.account` = portfolio_account_uuid
- `xact.security` = security_uuid
- `xact.shares` = shares × 10^8 (positive value)
- `xact.type` = `'BUY'`

**Record 2 — cash side:**
- `xact.account` = deposit_account_uuid
- `xact.security` = security_uuid (same as securities-side; changed by D4 fix 2026-03-26 to match ppxml2db fixture behavior)
- `xact.shares` = 0
- `xact.type` = `'BUY'`

**Cross entry:**
- `from_xact` = record1.uuid (securities side)
- `from_acc` = portfolio_account_uuid
- `to_xact` = record2.uuid (cash side) — NOT self-referential
- `to_acc` = deposit_account_uuid

## Balance calculation

### Deposit account balance

Uses `WHERE xact.account = deposit_account_uuid`. The cash-side record already has `account = deposit_account_uuid`, so no need to join through `xact_cross_entry`.

Sign rules:
- **Positive** (increase): DEPOSIT, INTEREST, TAX_REFUND, DIVIDEND, SELL
- **Negative** (decrease): REMOVAL, BUY, FEES, TAXES, INTEREST_CHARGE

### Securities account market value

`SUM(net_shares × latest_price)` for each security in the account:
- net_shares = SUM(BUY/DELIVERY_IN shares) - SUM(SELL/DELIVERY_OUT shares)
- price = latest_price, fallback to most recent historical price

## Critical rules

See `.claude/rules/api.md` for imperative rules:
- **NEVER use cross-entry in the WHERE clause** for per-account queries
- `deleteTransactionDeps` must find and delete the cash-side record
- Cash-side rows excluded from transaction list by: `NOT (type IN ('BUY','SELL') AND shares = 0)`

> Source: `packages/api/src/services/transaction.service.ts`
