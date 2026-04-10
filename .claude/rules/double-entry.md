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
