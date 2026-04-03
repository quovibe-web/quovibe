# Golden Dataset — Regression Tests

End-to-end tests that verify quovibe calculations against known correct values.
The only test that catches integration errors invisible to unit tests.

## How to generate fixtures

1. Open your portfolio app with a known portfolio (e.g. `demo-portfolio-03`)
2. Set the reporting period
3. Record for the portfolio: TTWROR, IRR, MVB, MVE, delta
4. Record for each security: TTWROR, IRR, Purchase Value, Market Value, gains
5. Record Calculation panel values (7 tabs)
6. Export `.db` with ppxml2db, save in `fixtures/`

## Status

No fixtures populated yet. High priority.
