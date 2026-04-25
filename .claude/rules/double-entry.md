globs: packages/api/src/services/**,packages/api/src/routes/transactions.*,packages/api/src/routes/accounts.*
---
# Double-Entry Transaction Rules

## Portfolio ↔ Deposit Accounts

A securities account (`type = 'portfolio'`) can be associated with **multiple cash accounts**
(each `type = 'account'`, each tied to a single currency). Multi-currency portfolios need one
cash account per currency.

The `referenceAccount` field on a portfolio points to the **default** cash account. It is a
UI/import convenience — it determines which cash account is shown as "linked" in the UI and
which one is used when a transaction does not explicitly specify a cash account. It does **not**
mean other cash accounts cannot hold transactions for the same portfolio.

### Auto-routing rules

When a transaction is created against a portfolio, the service layer routes it as follows:

| Group | Types | xact.account row |
|-------|-------|------------------|
| A — dual entry | BUY, SELL | **2 rows**: securities-side (account=portfolio, shares>0) + cash-side (account=deposit, shares=0) |
| B — cash only | DEPOSIT, REMOVAL, DIVIDEND, INTEREST, INTEREST_CHARGE, FEES, FEES_REFUND, TAXES, TAX_REFUND | **1 row**: account=deposit (if input.accountId is a portfolio, use referenceAccount) |
| C — shares only | DELIVERY_INBOUND, DELIVERY_OUTBOUND | **1 row**: account=portfolio |
| D — transfer | SECURITY_TRANSFER, TRANSFER_BETWEEN_ACCOUNTS | use crossAccountId |

### Transfer invariants (BUG-01 / BUG-04)

Group D transfers have two structural invariants the write path must enforce:

1. `accountId !== crossAccountId` — a transfer to itself is nonsense. Enforced in
   `createTransactionSchema.superRefine` (shared), so it rejects at the Zod boundary
   with 400 before the service ever runs.
2. Both accounts must be holders of the transferred asset class:
   - `TRANSFER_BETWEEN_ACCOUNTS` → both sides must be DEPOSIT (`type = 'account'`).
   - `SECURITY_TRANSFER` → both sides must be SECURITIES (`type = 'portfolio'`).
   Enforced in `enforceAccountTypeGuards` in `routes/transactions.ts`, which applies
   `isTransactionTypeAllowed` symmetrically to `accountId` and `crossAccountId`. 422
   on violation.

The `isPortfolioRouting` bypass in that guard only applies to types in
`CASH_ONLY_ROUTED_TYPES` (shared) — the types the service actually auto-routes to
`referenceAccount`. A transfer from a portfolio does NOT route to its reference
account; it is simply invalid and must be rejected.

## Per-type invariant matrix (BUG-106 / BUG-107 / BUG-111 / BUG-112 / BUG-113)

The transaction write path enforces a per-type matrix across THREE layers
because `@quovibe/shared` is I/O-free and cannot read `account.type` /
`account.currency` / `security.currency`. The single source of truth for the
type-grouping sets lives in `packages/shared/src/transaction-gating.ts`;
`createTransactionSchema` and `routes/transactions.ts` both import from there.

| Type                       | `securityId` | `shares` | `amount` | source `accountId` | dest `crossAccountId` | `fxRate` required when             |
|---------------------------|:------------:|:--------:|:--------:|--------------------|-----------------------|------------------------------------|
| BUY                       | **req**      | > 0      | > 0      | portfolio          | deposit (auto-route)  | cash.currency ≠ security.currency  |
| SELL                      | **req**      | > 0      | > 0      | portfolio          | deposit (auto-route)  | cash.currency ≠ security.currency  |
| DIVIDEND                  | **req**      | —        | > 0      | deposit *or* portfolio (auto-route) | —    | —                                  |
| DEPOSIT / REMOVAL         | —            | —        | > 0      | deposit *or* portfolio (auto-route) | —    | —                                  |
| INTEREST / INTEREST_CHARGE| —            | —        | > 0      | deposit *or* portfolio (auto-route) | —    | —                                  |
| FEES / FEES_REFUND        | —            | —        | > 0      | deposit *or* portfolio (auto-route) | —    | —                                  |
| TAXES / TAX_REFUND        | —            | —        | > 0      | deposit *or* portfolio (auto-route) | —    | —                                  |
| TRANSFER_BETWEEN_ACCOUNTS | —            | —        | > 0      | deposit            | deposit               | source.currency ≠ dest.currency    |
| SECURITY_TRANSFER         | **req**      | > 0      | **= 0**  | portfolio          | portfolio             | —                                  |
| DELIVERY_INBOUND          | **req**      | > 0      | **= 0**  | portfolio          | —                     | —                                  |
| DELIVERY_OUTBOUND         | **req**      | > 0      | **= 0**  | portfolio          | —                     | —                                  |

### Where each row is enforced

- **Schema layer** (`packages/shared/src/schemas/transaction.schema.ts`):
  - `securityId` requirement → `SECURITY_REQUIRED_TYPES` set (BUG-106).
  - `amount > 0` requirement → `AMOUNT_REQUIRED_TYPES` set; SECURITY_TRANSFER /
    DELIVERY_INBOUND / DELIVERY_OUTBOUND are deliberately excluded so they
    accept `amount = 0` (BUG-113).
  - `shares > 0` requirement → `PRICED_SHARE_TYPES` set.
  - Cross-account distinctness for transfer types (BUG-01).
- **Route layer** (`packages/api/src/routes/transactions.ts`):
  - `enforceAccountTypeGuards` checks both source and destination accounts
    against the type-allowlist (BUG-04). Removing BUY/SELL from
    `DEPOSIT_TYPES` is what closes BUG-107: the existing guard then rejects
    a deposit `accountId` for BUY/SELL with 422
    `TRANSACTION_TYPE_NOT_ALLOWED_FOR_SOURCE`.
  - `enforceCrossCurrencyFxRate` (run after the type guard) requires
    `fxRate` when:
    - `TRANSFER_BETWEEN_ACCOUNTS` source/destination currencies differ
      (BUG-111), OR
    - BUY/SELL cash-side (resolved to `crossAccountId` or
      `referenceAccount`) currency differs from `security.currency`
      (BUG-112).
    Returns 400 `FX_RATE_REQUIRED`.

The `CROSS_CURRENCY_FX_TYPES` constant in `transaction-gating.ts`
documents the same invariant — keep it in sync if a new type is ever
added that crosses currency legs.

## Double-entry BUY/SELL

For BUY and SELL, `createTransaction` / `updateTransaction` must create **2 xact rows**:

```
xact #1 (securities-side)
  account  = portfolio_uuid
  shares   = > 0
  security = security_uuid

xact #2 (cash counter-entry)
  account  = deposit_uuid  (defaults to referenceAccount when no cash account is specified)
  shares   = 0
  security = security_uuid  (same as securities-side; D4 fix 2026-03-26, matches ppxml2db)

xact_cross_entry
  from_xact = xact#1.uuid
  from_acc  = portfolio_uuid
  to_xact   = xact#2.uuid   ← NOT self-referential
  to_acc    = deposit_uuid
```

`getDepositBalance` calculates the balance with `WHERE xact.account = depositUUID` — without the
cash-side row, the cash account balance never reflects the BUY/SELL.

The cash-side row has `shares = 0` and is excluded from the transaction list by the query:
`NOT (type IN ('BUY','SELL') AND shares = 0)`.

`deleteTransactionDeps` must find and delete the cash-side as well:
search `xact_cross_entry WHERE from_xact = id AND to_xact != id` before performing DELETE.

## Per-account Query: NEVER use cross-entry in the WHERE clause (CRITICAL)

When listing transactions for a single account, the WHERE clause must be
**only `x.account = ?`**. NEVER add `OR ce.from_acc = ? OR ce.to_acc = ?`.

**Why**: every account already owns its own xact rows (`x.account = its own UUID`).
Adding conditions on `xact_cross_entry` in the WHERE clause pulls in xact rows from the other
account involved in the cross-entry, causing **duplicates** (e.g. BUY/SELL shows both the
securities-side row and the cash-side row in the deposit; transfers appear twice).

**Rule**:
- `xact_cross_entry` is used ONLY to retrieve the `crossAccountId` (subquery or JOIN),
  never to filter the rows to display.
- For the global transaction list (`/api/transactions`), exclusion is handled with
  `x.uuid NOT IN (SELECT to_xact FROM xact_cross_entry WHERE from_xact != to_xact)`.
- For the per-account list (`/api/accounts/:id/transactions`), `WHERE x.account = ?` is sufficient.
