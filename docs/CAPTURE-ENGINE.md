# Capture Engine 0.4

## Release contract
No OCR result is written to the catalogue automatically. A price observation requires a unique exact product match, explicit human confirmation, a valid decimal amount and an unchanged unit. Model scores are retained as scores, not represented as calibrated error probabilities.

## Reused upstream software
- `zxing-wasm` 3.1.4 (MIT wrapper / Apache-2.0 ZXing-C++): dedicated decoder worker; self-hosted reader WASM, restricted symbologies, two distinct camera frames, single-code targeting.
- `@paddleocr/paddleocr-js` 0.4.2 (Apache-2.0): official detection + Greek PP-OCRv5 mobile recognition, ONNX Runtime WASM/SIMD, single inference worker. No WebGPU or multi-thread claims on iOS.
- `tesseract.js` 6.0.1 (Apache-2.0): explicitly selected fallback, one reusable worker per capture session. Not a rewritten OCR engine.
- `onscan.js` 1.5.2 (MIT): opt-in keyboard-wedge scanner detection; input/textarea/select/contenteditable fields excluded from global interception.
- `dexie` 4.4.6 (Apache-2.0): user/store-scoped snapshots and durable confirmed-price outbox.

Official sources: https://github.com/Sec-ant/zxing-wasm ; https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js ; https://github.com/naptha/tesseract.js ; https://github.com/axenox/onscan.js ; https://github.com/dexie/Dexie.js

## Scope actually implemented
Camera lifecycle / cancellation / rear camera / feature-detected zoom and torch; bounded central ROI and backpressure; validated GTIN identifiers; deliberate duplicate-product rejection; still-image barcode decoder; Greek local OCR with spatial boxes and scores; manual crop/rotation and advisory image-quality warnings; raw OCR review; multi-file A4 navigation and draft CSV; offline catalogue snapshots; durable human-confirmed price queue; retry backoff; idempotent server receipts; private evidence images and source hashes; per-user/store isolation.

The original catalogue, authentication and prices are not reset by migration. Price and barcode capture are distinct operations: reading a barcode never writes a price or inventory quantity.

## Deployment
`npm ci && npm run build`. The build downloads four official model archives only when missing and refuses changed SHA-256 digests. The lockfile pins the JS/ONNX runtime dependency graph. All runtime models and WASM are served by the same app origin. Models are lazy; opening the dashboard does not download them.

Apply `supabase/migrations/20260919190000_capture_price_receipts.sql` before deploying this frontend. Runtime database access is authenticated, RLS-protected and security-invoker. Evidence bucket is private. Credentials are never bundled beyond the existing public Supabase publishable key.

## Important limits, not completed features
- A4 output is a review draft, not an approved mass import. Layout heuristics are not PP-StructureV3 and can fail on perspective/merged cells/handwriting. User-verified import and automatic perspective correction remain a separate release gate.
- No native Capacitor app, Apple Vision integration, WebHID driver, or Galaxy connector is deployed in this release.
- Actual barcode gun model and physical iPhone performance remain unmeasured. Keyboard emulation/browser emulation is not hardware certification.
- Synthetic OCR and barcode tests are smoke tests. They are not a 300–500-photo retail accuracy benchmark. Do not advertise zero errors, 99.x% precision or latency on real iPhones from them.
- Initial OCR model download is tens of megabytes; cold and warm measurements must be separated. Browser storage is device-local and can be cleared by Safari/the user. Export important pending records; do not treat the PWA as the sole backup.
- The current template has no batch/expiry stock ledger. Scanning improvements do not create those business features.
- npm audit previously failed upstream with HTTP 400. No clean dependency-audit claim is made.

## Tests
`npm run test:unit` exercises identifiers, integer-cent parsing, ambiguity handling, draft extraction and durable retry isolation. `npm run test:e2e` runs existing workspace checks plus capture checks in Chromium/mobile Chromium/WebKit; actual Greek model inference is a synthetic smoke test. Database receipt/tenant tests use temporary rows and a transaction rollback, never user records.
