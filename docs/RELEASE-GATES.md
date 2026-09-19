# Workspace 0.3 release verification

Scope: replace the sparse inventory dashboard while preserving the existing account, catalogue and authentication flow.

## Verified source
Application revision: 6946ce17e0e2cfebcd543f574d81345819f44bd9.
GitHub Actions verification: https://github.com/Steliosgeox/lixi-inventory/actions/runs/35453222767
The verification workflow committed the corrected application source before installing, building and testing it. This release-cleanup commit changes only documentation and removes that one-time workflow. Persistent CI continues to run on main, redesign branch and pull requests.

## Results
- Locked dependency installation and TypeScript/Vite production build: passed.
- Playwright: 27 expected, 0 unexpected, 0 flaky, 0 skipped; Chromium desktop, Chromium mobile, WebKit mobile emulation.
- Checks exercise actual rendered fixture-backed UI: data-derived metrics, Greek search, exact identifiers, table filters/sorting/pagination, selection/CSV, price-history drawer, atomic edit request, negative-price rejection, command search, theme persistence, manual scanner lookup and narrow layouts.
- Axe WCAG A/AA checks passed for dashboard light/dark, catalogue and product drawer.
- Light and dark screenshots inspected after corrections.
- Browser checks identified and fixed low text contrast, missing mobile search name, barcode-fragment matches taking precedence over exact item codes, and inconsistent first-sort direction.
- Additive save_inventory_product SQL migration applied to the existing project. Verified SECURITY INVOKER, no anonymous EXECUTE, authenticated EXECUTE with membership/RLS checks.
- Database records after migration: 398 products, 324 observations, 1 membership. No account or catalogue records were changed by this release.
- Static-only service-worker caching reviewed; cross-origin/database/authentication requests are not intercepted. Old Leaksy caches are cleared on activation.

## Boundaries
Test records are explicitly fictional and exist only in the Playwright test runner, not in the application or the production database. UI write tests intercept network requests; they do not modify real inventory. Physical iPhone camera, OCR accuracy and a user's authenticated production session are not covered by viewport/WebKit tests. Automated accessibility checks do not replace a full manual accessibility audit.

## Publication
Promote the verified application tree to main and confirm the Vercel production deployment references the release commit. The application remains on the existing lixi-inventory.vercel.app URL.
