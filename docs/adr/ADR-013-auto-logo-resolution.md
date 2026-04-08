# ADR-013: Stateless logo resolver endpoint for automatic logo fetching

**Status:** accepted
**Date:** 2026-04-08
**Supersedes:** —

## Context

Securities and accounts can have logos stored as base64 data URIs in the DB (`security_attr` / `account_attr` with `attr_uuid = 'logo'`). Previously logos could only be added via manual file upload. Users creating securities or accounts had to separately find and upload logos, adding friction.

Three approaches were considered:

1. **Frontend-driven fetch** — the web client fetches logos directly from CoinGecko/Yahoo/Google Favicon. Simple but introduces CORS issues (all three APIs restrict cross-origin requests) and leaks API URLs to the client.

2. **Embedded-in-creation** — the creation endpoints (`POST /api/securities`, `POST /api/accounts`) fetch logos inline. Couples the creation path to potentially slow external calls (up to 8 seconds per strategy), increasing perceived latency on a normally fast operation.

3. **Separate stateless resolver endpoint** (`POST /api/logo/resolve`) — the API acts as a proxy. Logo fetch is decoupled from creation. Frontend fires it non-blocking after creation succeeds. The endpoint has no DB access; it only takes identifiers and returns a base64 URI or 404.

## Decision

Option 3: a single stateless resolver endpoint at `POST /api/logo/resolve`.

**Resolution strategies (in priority order):**
- CRYPTO: CoinGecko `/coins/list` → `/coins/{id}` → `image.large` URL → base64
- EQUITY / ETF / BOND / FUND / COMMODITY / INDEX: Yahoo Finance `quoteSummary` with `assetProfile` module → extract `website` → strip to bare domain → Google Favicon `?sz=128`
- Account (domain-only request): Google Favicon directly
- Fallback (all ticker-based): `{ticker.toLowerCase()}.com` favicon
- Final: throw 404

Each strategy has an 8-second timeout. No retries — fail fast.

**Frontend flow:**
- On security/account creation success: fire `useResolveLogo()` mutation non-blocking; store result via existing logo PUT endpoints; show toast on failure.
- In editors: "Fetch logo" button triggers the same mutation on demand.

## Consequences

**Positive:**
- No CORS issues — all external calls are server-side.
- Creation endpoints remain fast — logo fetch is always non-blocking.
- Single hook (`useResolveLogo`) shared by all surfaces.
- No DB schema changes required.
- Manual upload path unchanged.

**Negative / Trade-offs:**
- Every logo fetch hits external APIs in real time (no server-side cache). Acceptable for a single-user app where explicit re-fetch is an intentional user action; base64 is stored in DB on first success.
- Rate limiting on CoinGecko free tier may cause failures for rapid successive crypto additions. Mitigated by the 404 → manual-upload fallback.
- Yahoo Finance `quoteSummary` is an unofficial API; breakage risk exists. Mitigated by the Google Favicon fallback.
