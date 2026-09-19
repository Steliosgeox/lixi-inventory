# Leaksy workspace 0.3

A light, inventory-first interface with a persistent dark theme. This is an operations dashboard, not a marketing template: all counts and visualisations derive from loaded catalogue records. No invented quantities, inventory values, revenue or historic trends.

## Incorporated libraries
- Phosphor React: MIT icon components; bundled and tree-shaken.
- Radix Dialog: MIT focus management, escape handling, modal accessibility and portals.
- TanStack Table 9.2.4: MIT table implementation; explicit v8-compatible legacy adapter supports sorting, selection and pagination while keeping the installed v9 version pinned.
- IBM Plex Sans: OFL font via Fontsource, Greek and Latin subsets, locally bundled.
- Existing Supabase, ZXing and Tesseract flows preserved.

Taste redesign guidance and Unlazy completion gates informed the audit. Their text or tools are not shipped in the runtime. No website is declared 'perfect' on the basis of a compile.

## Behaviour
- Navigation, searchable catalogue, keyboard command search, price filters, selection and CSV export.
- Print current table page; CSV exports all filtered records, or the selection.
- Separate location coverage and latest-observation screens. Product drawer contains an independently fetched 20-entry price history.
- Barcode/manual lookup and local OCR, with explicit review; ambiguous OCR prices are not automatically selected.
- Auth flow retained; no new users, passwords, confirmation bypasses or memberships created for this refactor.
- Product/position changes use one transactional, security-invoker RPC. Migration is additive and does not change catalogue records.
- Service worker caches only same-origin static assets and shell. Account and Supabase requests are not cached. Stale earlier Leaksy caches are removed.

## Verification boundaries
Playwright uses clearly fictional fixtures intercepted only by the test runner, not a production bypass. Chromium desktop/mobile and WebKit checks run in GitHub Actions. This is not a physical iPhone camera test. CSV codes must be imported as text in Excel to preserve leading zeroes. OCR accuracy has not been re-benchmarked in this frontend release.
