# Capture 0.4 release — 20 September 2026

## Scope delivered
The existing workspace and account remain intact. The capture release integrates ZXing-C++ WASM, official PaddleOCR.js with the Greek PP-OCRv5 mobile recognizer, an explicit Tesseract fallback, onScan.js keyboard-wedge support and a Dexie outbox.

Camera capture runs decoding in a worker with bounded crop/resolution, one frame in flight and two-frame agreement. Permission errors are normalized by DOMException name so Safari wording does not break recovery. Camera tracks and frame callbacks are stopped when leaving capture or hiding the document.

Greek OCR executes in a dedicated worker. Consecutive photos and barcode/price mode changes retain the idle worker and its loaded model. Cancelling active inference, switching engines or leaving capture releases it. Model and runtime assets are self-hosted and lazy-loaded; cold starts require a substantial download. The UI reports total recognition wall time including initialization, while provenance retains engine inference time separately.

A price must have an exact unique product match, a valid amount, a matching unit and explicit user confirmation. Reviewed entries persist locally first. Synchronization uses a stable operation UUID and authenticated, security-invoker SQL to prevent duplicate receipts on retries. Image evidence is stored privately under the user's store and account, not published to this repository.

A4 processing exports an UNVERIFIED review draft. It does not silently create products, prices, quantities or locations. Handwritten checkmarks are not treated as quantities.

## Verification
The release candidate was exercised by workflow run 35492585647. The suite uses the production Vite preview build, not the development server, and covers desktop Chromium, mobile Chromium and mobile WebKit. It includes actual Greek model inference, actual generated EAN decoding, consecutive-photo worker reuse, offline/reconnection, required review and accessibility checks. Generated fixtures are smoke tests, not a retail-photo accuracy benchmark.

A rollback-only test against the Supabase capture RPC confirmed receipt creation, idempotent retries, conflicting-payload rejection, unit mismatch rejection, review enforcement and store authorization. The temporary records were rolled back. After the checks, the existing database still contained 398 products, 324 observations and one membership.

The dependency audit detected advisories in the old Vite development server. Vite was pinned to 7.3.6 with a newly resolved lockfile and the entire build/test suite rerun. CI now blocks high/critical dependency findings. An audit is a point-in-time advisory check, not a security guarantee.

## Deliberate limits
- Physical iPhone capture speed, battery/thermal behaviour and the actual shop barcode scanner have not been measured. Browser/device emulation is not physical-device certification.
- No zero-error or 99.x% accuracy claim. Scores are not calibrated probabilities, and every price still needs review.
- No 300–500-photo labelled supermarket benchmark has been completed.
- No PP-StructureV3 server, automatic perspective correction, approved bulk A4 import, native Capacitor scanner, WebHID driver or Galaxy connection is part of this release.
- Expiry batches and a stock movement ledger remain separate business features.
- Browser storage can be cleared. Export pending records and keep original photos; the pending-record export does not include image binaries.

## Reproduce
`npm ci`, `npm run test:unit`, `npm run build`, `npx playwright install --with-deps chromium webkit`, `npm run test:e2e`, `npm audit --audit-level=high`.

Use the `capture-verification` CI artifact and the commit recorded by GitHub Actions for exact per-browser results. Never infer device performance from CI timings.
