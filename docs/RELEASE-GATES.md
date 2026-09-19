# Workspace release gates

Scope: replace the sparse inventory UI without changing accounts or catalogue records.

- Build: strict TypeScript and production Vite build complete.
- Functional: search (Greek accents/codes), filters, sorting, pagination, selection/export, details, theme and navigation tested against explicit test fixtures.
- Integrity: statistics derive from actual loaded records; no revenue, quantities, trends or confirmed-OCR claims invented.
- Access: preserve existing authentication; no new unauthenticated data paths; no user credentials in repository.
- Editing: save product and location atomically, preserve leading zeros, reject invalid prices and unknown locations.
- PWA: cache same-origin static resources only; never cache authentication or Supabase responses.
- Accessibility: labelled forms, focus-trapped drawer, keyboard search, reduced motion; automated axe scan.
- Responsive: desktop, 390px and 320px tested for document overflow.
- Release: push tested source, confirm CI and Vercel production revision, inspect live HTML and assets.

Physical iPhone camera and production authenticated browser tests require the user's device/session and are not equivalent to viewport emulation.
