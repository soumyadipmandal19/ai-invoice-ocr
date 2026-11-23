# Server code

For endpoint URLs, request bodies, responses, and client examples, see the
[API reference](../../docs/api/API.md).

All runtime modules here are server-only. Keep browser-safe types in `types/`
and shared pure transformations in `lib/`.

```text
lib/server/
├── auth/
│   ├── handlers.ts     JSON parsing, Origin checks, HTTP responses, cookies
│   ├── service.ts      Shared validation, rate limits, signup/login workflow
│   ├── store.ts        Neo4j user/session queries and password hashing
│   └── session.ts      Cookie configuration and current-user lookup
├── database/
│   ├── neo4j.ts        Shared Aura driver and connectivity check
│   └── schema.ts       Persisted node types, constraints, indexes, initialization
├── bills/
│   ├── handlers.ts     Authenticated bill-save and snapshot-read endpoints
│   ├── service.ts      Shared Inngest/API save workflow
│   ├── normalize.ts    Convert mapped fields without guessing ambiguous values
│   └── store.ts        Idempotent owner-scoped graph transaction
├── http/
│   └── request.ts      Shared Origin checks and bounded JSON parsing
├── classification/
│   ├── queue.ts        Submit classification jobs to Inngest
│   └── store.ts        Temporary classification job files and expiry
├── extraction/
│   └── extract-document.ts  Run the Python OCR worker
└── ai/
    └── openrouter.ts   OpenRouter calls and response validation
```

The dashboard profile dropdown lives in `components/profile-menu.tsx`; account
deletion calls `DELETE /api/auth/me` and requires typing `DELETE` to confirm.

HTTP entry points remain under `app/api/`. Signup and sign-in forms call those
endpoints; the dashboard sign-out action remains under `app/actions/`. Entry
points delegate to server modules rather than duplicating business logic.
Authentication follows:

```text
components/auth-form.tsx → app/api/auth/* → auth/handlers.ts → auth/service.ts → auth/store.ts
app/actions/auth.ts (sign-out) ──────────────────────────────────────────────→ auth/store.ts
protected pages/API → auth/session.ts → auth/store.ts
                                              ↓
                                      database/neo4j.ts
```

Authentication and organized bills/items persist in Aura. Classification job
storage still uses the local filesystem; local jobs expire after 24 hours, while
saved bill graphs remain until explicitly deleted with the account. Put new server
features in a named responsibility folder and update this map when adding one.

`database/schema.ts` is the central graph schema module. Stores import its node
types and call `ensureDatabaseSchema()` before using the database. Initialization
is shared by concurrent callers and runs once per module lifetime after success;
failed initialization can be retried. Cypher statements use `IF NOT EXISTS` so
other processes can initialize the same database safely. Add future constraints,
indexes, and persisted node types here. TypeScript node types describe the data
the application writes; database constraints enforce only the declared rules.
Browser-safe public response types remain in `types/`.

The common Bills/Bill Items dataset is described in
[`data/bills/README.md`](../../data/bills/README.md). Shared record types are in
`types/bills/models.ts`; the central schema extends these as `BillNode` and `BillItemNode`
with persistence metadata and source workbook properties.
Bill constraints are initialized with the rest of the schema. Inngest calls
`bills/service.ts` after staging an organized workbook; `POST /api/bills` shares
that service for retrying owned jobs. Account deletion cascades through owned
bills, items, and linked OCR/AI snapshots. Saved-history listing uses the verified session owner ID; browser corrections
remain separate work.

Current-user lookups call Next.js `connection()` before session validation so
expiry checks run at request time with Cache Components. Keep these checks
uncached. Pages put the session-reading child inside an explicit Suspense
boundary, reusing `app/loading.tsx` as the fallback. This gives each destination
its own immediate loading UI, including navigations within the root layout.

`types/workflow/artifacts.ts` defines the private original OCR and validated AI
snapshots. Classification staging writes them atomically to `.artifacts` files
without adding full OCR to public status polling or Inngest event/step results.
`bills/store.ts` persists OCRExtraction/LLMResult nodes alongside the bill and
items in one transaction. Their model definitions and unique ID constraints live
in `database/schema.ts`. `GET /api/bills/[id]` returns both snapshots to the owner.

`GET /api/bills` pages through the signed-in user's saved graph using a
parameterized owner ID derived from the session. The client loads this endpoint
on mount and uses `lib/bills/history.ts` to restore saved document tabs without
re-polling temporary jobs or overwriting current edits. See `types/bills/responses.ts`
for the page shape and [the API reference](../../docs/api/API.md) for pagination and error details.

`DELETE /api/bills/[id]` deletes an owned bill and its typed child nodes in a
single transaction, then removes its local classification cache. A private list
of deleted bill IDs on User prevents late workflow retries from recreating data.
Keep that guard and owner-lock ordering aligned with bill saves/account deletion.


Financial organization quality checks:
- `lib/financial-organization.ts` creates bounded version 3 input batches. Inferred
  fields absent from the raw text are excluded. SKU/category continuation lines
  are linked to their product anchor and kept in the same batch. Cached version 1/2
  plans retain their previous input layouts when an Inngest run retries.
- `lib/financial-validation.ts` rejects order-number/payment-method label confusion,
  recovers unique explicit document/order/shipping identifiers, and flags arithmetic
  discrepancies without changing printed amounts. It leaves conflicting identifiers
  blank. Arithmetic checks skip ambiguous numeric formats and adjusted item rows.
- `order_id` and `shipping_method` are distinct receipt-sheet fields, persisted as
  `Bill.orderId` and `Bill.shippingMethod`. Old snapshots remain readable unchanged.
- Source OCR remains immutable. New prompts and checks apply to new workflow runs;
  existing saved bills are not silently remapped. Regression tests mock provider
  responses, so passing tests does not establish a live-model accuracy percentage.
