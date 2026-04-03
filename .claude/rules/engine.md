globs: packages/engine/**
---
# Engine Rules

- Use decimal.js for EVERY calculation. Never native Numbers for amounts or percentages.
- Functions receive arrays of transactions/prices and return results. Zero I/O.
- Fees are intrinsic to the transaction (included in the security's performance).
- Taxes are extrinsic (excluded by default from the security's performance).
- Cashflow levels:
  - Portfolio: only Deposit, Removal, Delivery In, Delivery Out
  - Security: Buy, Sell, Dividend, Delivery In, Delivery Out
  - Account: Deposit, Delivery In, Dividend, Interest, Fees Refund, Tax Refund (inflows) — used by `resolveAccountCashflows`
- Every public function must have tests with concrete numeric values verifying correctness.
- TTWROR: daily holding periods, CFin at the start of the day, CFout at the end of the day.
- IRR: Newton-Raphson, max 100 iterations, tolerance 1e-10. Falls back to Brent's method (bisection, 200 iterations) if Newton-Raphson fails to converge.
- If native arithmetic is genuinely intentional (e.g. array index, loop counter, non-financial
  integer), add `// native-ok` at the end of the line to suppress the architecture check warning.
