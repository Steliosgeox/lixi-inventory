# Leaksy Inventory

Leaksy Inventory is a mobile-first supermarket inventory and price-audit PWA built with React, TypeScript, Vite and Supabase.

## Current capabilities

- Product master data with internal code, barcode, description, unit and catalogue price
- Shelf-price history and catalogue-vs-shelf variance tracking
- Product location tracking by position, row and number
- Barcode scanning from the browser camera via ZXing
- Greek/English shelf-label OCR and A4 inventory-sheet OCR with mandatory human review
- Supabase Auth + Row Level Security
- Installable PWA for iPhone/Android and responsive desktop UI

## Stack

- React 19 + TypeScript
- Vite 7
- Supabase Postgres/Auth/RLS
- ZXing browser barcode scanning
- Tesseract.js local OCR fallback
- Vercel hosting

## Local development

```bash
npm install
npm run dev
```

The production Supabase project uses a publishable key only. No Supabase secret/service-role key belongs in this repository.

## Build

```bash
npm run build
npm run preview
```

## Data safety

OCR results are review-first. Image-derived values are never silently written as verified inventory data without an explicit confirmation step.
