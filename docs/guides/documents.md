# Document library

The dashboard's **Review** card opens `/workspace/documents`. The dashboard keeps the
combined **All bills** workbook; saved files no longer add document tabs beside it.
**Open bill & source** in the workbook opens the saved document's dedicated page.
New, unsaved uploads keep their processing/review view until financial saving
completes, then return to All bills. Nonfinancial and failed unsaved results remain
available in the current dashboard session; this library lists persisted bills.

The library uses a file-browser layout with one **All bills** collection, grid/list
views, filename/bill-number search, and paginated loading. Bills, invoices, and
receipts appear together; their processing classification stays internal. The UI
does not apply document-type folder filters or move existing graph records. `GET /api/documents` returns only metadata, 50 files per page,
and owner-wide folder counts. Search/folder filters run server-side over all owned
records, not only the currently loaded page. All responses are uncached and owner
identity comes from the signed-in session.

Click a file to open `/workspace/documents/[id]`. It reuses the existing bill/structured/text
reviewer and exposes original OCR JSON and the saved AI snapshot as separate views.
It never starts a new OCR or model job for a restored bill. The original upload
binary is not stored by the existing extraction pipeline; these pages show saved
OCR and extracted data. Spreadsheet edits remain local to the detail page until
export; they do not update the saved OCR or graph automatically.

Page access checks the signed-in user, and document lookups traverse that user's
owned bill relationship. Unknown and foreign IDs return the same not-found view.
Unavailable database data has a retry view. Old records without OCR/AI snapshots
continue to show their available workbook rather than inventing missing output.

Checks:

```bash
npm run test:documents
npm run test:history
npx tsc --noEmit
npm run check:embedding-model
```

The first checks cover owner-scoped metadata, search, folders, pagination and safe
errors. The live database check validates metadata queries against rolled-back
fixtures in addition to embedding storage.

## Returning without losing your place

The root `WorkspaceProvider` injects a tab-local in-memory store. Authenticated pages scope that store by user and workspace. The dashboard retains loaded bill records, local workbook edits, filters, sheet, selected cell, pagination, zoom, wrapping and horizontal/vertical grid scroll during client navigation. The library retains its search, view, loaded pages and scroll; individual bill pages retain their review state. Links and `router.push` use client routing.

Completed history and library requests are reused for five minutes. Returning after that revalidates the requested page while keeping existing data visible. Explicit pagination and retry still fetch. Grid identity excludes row contents, so loading more records does not remount the workbook. Native scroll recording does not trigger React renders.

This cache uses neither localStorage nor server data caching. Browser refresh resets it, and signing out or switching users clears it. Server pages and APIs still validate authentication. Export local corrections before refreshing.

Run `npm run test:workspace` for route-state retention and store isolation regression checks.

The `/workspace/dashboard` and `/workspace/documents` routes share `app/workspace/layout.tsx`. That layout authenticates the workspace and owns `WorkspaceShell`. The shell keeps the dashboard in React Activity while document screens are visible, so returning reveals the same workbook DOM rather than passing through the dashboard page's authentication/loading boundary. Its lifetime does not depend on Next.js keeping the dashboard in its limited page cache. The regular workspace directory adds `/workspace` to these public URLs. Data APIs and individual document pages still check the session and ownership.

Browser verification (2026-11-24): isolated headless Chrome with a temporary authenticated account and an intercepted synthetic 250-item history response. Selected row 190 and scrolled its grid to 2422px, opened Documents, returned via Dashboard, then used browser Back/Forward. The same dashboard and table DOM survived; row 190 remained selected and scroll stayed at 2422px. Recorded zero document navigation requests, zero history refetches after leaving the dashboard, and zero browser exceptions. The temporary account was deleted afterward.

The shell always renders the Next.js `children` slot. Only the persistent workbook is placed in a hidden Activity. Hiding the router slot on `/workspace/dashboard` prevents the framework from traversing its page segment and triggers `instant-unrendered-segment`. `test:workspace` renders the real shell at dashboard, library and document paths to guard this requirement.

Column changes update the existing grid instead of changing its React key. Cells and column headers use source column IDs so inserting an optional column does not reuse a different field's cell. Column changes retain pagination and selected row; stale editors cannot commit across a changed column schema. Store notifications use a subscriber snapshot to prevent a React resubscription from extending the dispatch loop.

After the route-group move, an observed Turbopack development loop repeatedly sent `restart` for the same runtime chunk and interrupted streamed Suspense rendering. Stopping dev, moving the generated `.next/dev` cache aside, and restarting ended the loop in verification. The final Chrome check toggled optional columns 24 times, retained the same table DOM and row 190 at 2422px, then passed Dashboard/Document navigation and browser Back/Forward with no console errors. Chrome's native crash itself was not reproduced or conclusively attributed.

Review navigation: the shared authenticated shell supplies the library's owner scope, so the Documents page no longer repeats a database session read before rendering. `documents/loading.tsx` provides route-specific loading UI, and the Review link prefetches the destination and shows a pending hint. The documents API still checks the session and owner. In an isolated local Chrome check with the API delayed by 1500ms, the library UI opened in 148ms before data arrived; returning preserved row 190 and grid scroll with no document requests or console errors. This is a single local measurement, not a latency guarantee.

The column picker now uses `components/column-picker.tsx`, a native auto popover, so its controls live in the browser top layer rather than in the sticky table's overlapping paint/hit-test contexts. Before this change, a corrected physical-pointer test found that `elementFromPoint` at an unchecked option returned the grid viewport; earlier synthetic/programmatic checks did not establish that real pointer clicks reached a checkbox.

Verification used a normal isolated Chrome window, full accessibility, a Retina viewport and a read-only in-memory copy of the four saved sample bills. All 12 optional field checkboxes were reached by real mouse events and each assertion confirmed its checked state changed. No renderer crash or console error occurred. Escape and route navigation closed the popover correctly. The user's original-profile native crash was not reproduced or conclusively attributed; the concrete dropdown hit-testing defect was reproduced and fixed. Workspace/workbook regression suites passed 25 tests.

When model mapping yields no verified product rows, an explicit four-column OCR table (`Item/Description`, `Qty`, `Rate/Unit price`, `Amount/Line total`) can recover printed item values. Adjacent wrapped name lines are joined; SAC/HSN codes and document totals are excluded. No missing quantity, rate or amount is calculated. Recovery is labeled for source review. Bank-statement transactions and existing nonempty/edited item sheets are left alone.

New processing uses this fallback before building/persisting the workbook. Older saved empty workbooks are recovered as a read-only view in the bill APIs and the combined dashboard, preserving the stored OCR/LLM snapshots and current-session edits. The dashboard also identifies bills whose item rows remain missing. Recovered display rows are not a migration of historical BillItem nodes; no existing database data is rewritten by reading a bill.

For SR-58213, saved OCR split `Paneer Tikka` into a priced `Paneer` line and a following `Tikka` line (and similarly for the other four products). Literal model citations rejected those joined names, leaving zero structured items. The read-only regression now recovers five source-backed rows, keeps their parent Bill ID/number, and produces 14 combined item rows instead of 9. Snapshot hashes and database update counters remained unchanged. The workbook, classification and bill suites passed 81 tests.

## Persisted item recovery

The authorized one-time repair of SR-58213 is complete: five BillItem nodes and five HAS_ITEM relationships, saved itemCount 5, unchanged original snapshot hashes, no deletions and an idempotent verification. The temporary repair CLI, helper and repair-only tests have been removed.

Bill-reading APIs retain support for `Bill.itemRecoveryWorkbookJson`, which holds the persisted corrected view without overwriting original OCR/AI/workbook snapshots. Normal saves recover source-backed rows before normalization and count actual linked BillItem nodes. A general save-path regression verifies that recovered rows reach persistence before a job is reported complete.
