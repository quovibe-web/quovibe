# 15 Transaction Types

quovibe supports exactly 15 transaction types, groupable into pairs with opposite effects.

## Complete mapping

| # | Type | Effect Securities Account | Effect Deposit Account | Effect Portfolio |
|---|------|--------------------------|-------------------------|-------------------|
| 1 | **Buy** | +shares | -cash | none (internal) |
| 2 | **Sell** | -shares | +cash | none (internal) |
| 3 | **Delivery Inbound** | +shares | none | +inflow |
| 4 | **Delivery Outbound** | -shares | none | -outflow |
| 5 | **Deposit** | none | +cash | +inflow |
| 6 | **Removal** (Withdrawal) | none | -cash | -outflow |
| 7 | **Dividend** | none* | +cash | none (internal) |
| 8 | **Interest** | none | +cash (no cashflow) | none |
| 9 | **Interest Charge** | none | -cash (no cashflow) | none |
| 10 | **Fees** | none | -cash | none (internal) |
| 11 | **Fees Refund** | none | +cash | none (internal) |
| 12 | **Taxes** | none | -cash | none (internal) |
| 13 | **Tax Refund** | none | +cash | none (internal) |
| 14 | **Security Transfer** | ±shares (between accounts) | none | none |
| 15 | **Transfer Between Accounts** | none | ±cash (between accounts) | none** |

*Dividend generates an outflow from the security and an inflow into the deposit, but the portfolio balance doesn't change.

**Transfer between accounts with currency exchange can generate currency gain/loss.

## Fundamental rule for performance

**At portfolio level**, only 4 transactions generate cashflow: Deposit, Removal, Delivery In, Delivery Out. All others are internal movements.

**At security/security account level**, 5 transactions are relevant: Buy, Sell, Dividend, Delivery In, Delivery Out.

## Fees and Taxes Treatment

quovibe clearly distinguishes:
- **Fees**: intrinsic to the transaction. Included in the security performance calculation.
- **Taxes**: extrinsic. Excluded by default from the security performance calculation (option "Pre-tax" / "After-tax").

## Source files

- Enum: `packages/shared/src/enums.ts` — `TransactionType`, `CostMethod`, `AccountType`
- Cashflow constants: `packages/shared/src/enums.ts` — `PORTFOLIO_CASHFLOW_TYPES`, `SECURITY_CASHFLOW_TYPES`
