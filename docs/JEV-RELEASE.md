# Jev photo automation — 0.5.0

## Workflow

The default capture tab is **Φωτογραφία → Jev**. Each image is persisted in IndexedDB, normalized once, and read by the pinned Greek PP-OCRv5 model and ZXing-C++ WASM. The immutable OCR/barcode evidence goes to the authenticated `lixi-jev` Edge Function. It calls OpenRouter **Decisions**, not chat completions, using `typesafe/jev-1.13`.

Jev evaluates every submitted capture. The application constructs candidates from observed evidence and enforces membership, check digits, date validity, confidence gates, single-product association and catalogue version checks. Passing decisions create price observations and physical expiry batches atomically. Rows carry `approval_source=jev_policy` and `reviewed=false`; model decisions are not presented as human reviews.

An existing product's missing barcode can be enriched when observed evidence agrees. New products require an observed seven-digit store code, a decoded valid GTIN, readable description and explicit unit. Shelf observations never overwrite catalogue prices. Only a known physical location is inherited. Missing information is not invented. Multiple labels or batches in a photograph go to review; this release is not an automatic multi-row A4 importer.

## Activation

An owner opens **Σύνδεση OpenRouter / Jev** in capture, enters an OpenRouter key and presses **Σύνδεση Jev**. The server probes the actual Decisions endpoint before storing the credential in per-store Supabase Vault. The key never enters browser storage or source control, and the input clears after each attempt. Server-only `OPENROUTER_API_KEY` configuration is also supported.

A missing key or API outage produces an explicit waiting state, not a fabricated successful capture. Offline pictures remain queued. Reviewed Smart Scan and individual OCR remain available as fallback workflows. Live model accuracy must be evaluated on real shop images; synthetic fixtures do not prove perfect accuracy.

## Morning synchronization

The `lixi-jev-morning` pg_cron job wakes every 20 minutes. A Europe/Athens time guard dispatches only at **07:00, 07:20, 07:40, 08:00, 08:20, 08:40 and 09:00**, including daylight-saving changes. Jobs use one-use tickets, unique store/time slots and database call budgets. Each cycle retries up to eight eligible failed/stalled uploads and records expiry-alert and missing-barcode counts. It does not repeatedly charge for completed captures or fetch photos that exist only on a closed/offline phone.

Monitoring summaries appear in the application. They are not iOS push notifications. A missing provider produces a blocked job receipt. The model interprets fields; deterministic code performs arithmetic, permissions and database transactions.

## Verification

Unit tests cover typed Decisions responses, invalid distributions, no-match outcomes, source identity, GTIN checks, dates, multiple-product/batch quarantine and stable retries. Browser tests cover real OCR/decoder engines on synthetic fixtures, offline retention, provider setup, mobile layout and fallback workflows. WebKit device emulation is not a physical iPhone camera benchmark.

CI checks the Deno server entrypoint and the React/TypeScript application. Credentials are provisioned separately from release source. The Edge deployment pins the verified server source commit.
