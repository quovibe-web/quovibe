# Cashflow Model

This is the heart of quovibe's cashflow system. Each transaction generates different cashflows depending on the *level* at which performance is calculated.

## Cashflow levels

**Portfolio level** — only 4 transactions generate cashflow:
- Inflow: Deposit, Delivery Inbound
- Outflow: Removal, Delivery Outbound
- Buy/Sell/Dividend are NOT portfolio cashflows

**Security Account level** — most types are relevant:
- Inflow: Buy, Delivery Inbound, Dividend (received)
- Outflow: Sell, Delivery Outbound, Transfer Out

**Security level** — 5 types:
- Inflow: Buy, Delivery Inbound → CF = +(grossAmount + fees)
- Outflow: Sell, Delivery Outbound, Dividend → CF = -(grossAmount - fees)
- In both cases fees worsen performance

## Fee/Tax sign convention (CRITICAL)

**Inflow** (Buy, Delivery In): `CF = +(grossAmount + fees)`
- Fees INCREASE the entry cost → worse performance
- Example: buy 10×10 + 3 fees = +103

**Outflow** (Sell, Delivery Out, Dividend): `CF = -(grossAmount - fees)`
- Fees REDUCE the exit revenue → worse performance
- Example: sell 5×12 - 5 fees = -55

**Taxes** (when `includeTaxes=true`):
- Inflow: taxes INCREASE the cost → added
- Outflow: taxes REDUCE the revenue → subtracted

Default is `preTax=true` (taxes excluded from performance).

## cfIn/cfOut splitting

The cashflow resolver produces signed amounts (positive=inflow, negative=outflow). The TTWROR `DailySnapshot` requires separate cfIn and cfOut, both ≥ 0:

- `cfIn` = sum of positive amounts (Buy, Deposit, Delivery In)
- `cfOut` = sum of |negative amounts| (Sell, Dividend, Removal, Delivery Out)

## Source files

- Cashflow types: `packages/shared/src/cashflow.ts`
- Resolvers: `packages/engine/src/cashflow/resolver.ts`
- Portfolio level: `packages/engine/src/cashflow/portfolio-level.ts`
- Security level: `packages/engine/src/cashflow/security-level.ts`
