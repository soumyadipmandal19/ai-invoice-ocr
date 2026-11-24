# Local document embeddings

This integration generates and stores embeddings only. The chat preview and
answer-generation models are unchanged. It uses the existing Python environment,
Inngest, and Neo4j. No Nomic API key is required.

The dashboard header also has an **Embedding demo** button. Enter up to 1,000
characters to generate and inspect all 768 vector values. This demo calls
`POST /api/embeddings/demo` directly: input/output remain in request/browser memory,
are not queued or saved to Neo4j/files/browser storage, and the UI clears them on
close/reset. The model weights remain cached for inference. Authentication reads
the existing session; the demo does not create document records. The demo itself
doesn't need Inngest or `EMBEDDINGS_ENABLED`; it needs the local Python/model setup.

## Setup

From the repository root:

```bash
npm run setup:python
npm run download:embeddings
```

The first command creates `.venv` and installs all OCR and embedding libraries
from `python/requirements.txt`. For an existing environment, `npm run setup:embeddings`
also installs that same requirements file. The second command uses `.venv/bin/python`
to download `nomic-embed-text-v1.5.f16.gguf` (approximately
274 MB) into `.data/models/nomic/` and verifies local inference. Libraries and the
model weights are separate downloads. `.data/` is ignored by Git.

Set these server environment variables in `.env.local`:

```dotenv
PYTHON_EXECUTABLE=.venv/bin/python
EMBEDDINGS_ENABLED=1
EMBEDDING_MODEL_PATH=.data/models/nomic
EMBEDDING_DEVICE=cpu
```

If you downloaded the model elsewhere, set `EMBEDDING_MODEL_PATH` to that
directory. It must contain the exact `.gguf` filename above. The setup command
reads shell environment variables, not `.env.local`; export an override in your
shell too if using a custom download location. The optional
`EMBEDDING_PYTHON_EXECUTABLE` overrides `PYTHON_EXECUTABLE` for the runtime worker.

Restart Next.js and run the Inngest development server in another terminal:

```bash
npm run dev
```

```bash
npm run dev:inngest
```

Runtime generation uses `inference_mode="local"` and `allow_download=False`:
document text is never sent to Nomic and missing weights cause a retryable failure
rather than a hosted API fallback. The explicit download command requires internet.

## New documents

After a supported financial document is saved, the shared save service queues
`document/embedding.requested`. The `embed-saved-document` Inngest function runs
one document at a time, with two retries. A scheduling/model failure does not undo
the saved bill or its OCR snapshot. Retry failed or unscheduled bills through the
endpoint below. If a process crash leaves a job queued without delivery, the
endpoint permits requeueing it after 15 minutes. Request IDs discard stale results.

Only persisted bills with original OCR snapshots can be indexed. Nonfinancial
documents currently aren't persisted by this app and cannot be backfilled.

## Existing documents and status

For administrative backfills of **all owners' saved bills** in the configured
database, run from the repository root:

```bash
npm run backfill:embeddings -- --dry-run
npm run backfill:embeddings -- --run
```

This maintenance command processes bills sequentially with the local worker and
saves directly through the shared embedding store; it does not require Inngest.
It derives ownership from the graph, migrates legacy groups, reuses ready vectors,
and reports missing OCR, active jobs, failures, and final chunk consistency. A
rerun safely skips current ready groups and retries failed documents. The default
without `--run` is a read-only dry run. It prints counts/statuses, never OCR or
vectors. Use the session-scoped endpoint below for normal website requests.

While signed into the app, run this in the browser console:

```javascript
const response = await fetch('/api/embeddings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ offset: 0 }),
});
console.log(await response.json());
```

This queues up to ten of the current user's saved bills. Repeat with the returned
`nextOffset` until it is `null`. Ready/queued documents using the current profile
are skipped; older records without usable OCR report `OCR unavailable`. Paging
doesn't remove ready bills from the list, so offsets remain stable unless bills
are added/deleted concurrently. Re-running the backfill is safe.

For a single bill or a failed-job retry:

```javascript
await fetch('/api/embeddings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ billId: 'YOUR-SAVED-BILL-UUID' }),
});
```

Read progress without returning private vectors/text:

```javascript
const response = await fetch('/api/embeddings?billId=YOUR-SAVED-BILL-UUID');
console.log(await response.json());
```

States are `not_indexed`, `queued`, `ready`, and `failed`. `ready` with zero chunks
means the saved OCR has no nonblank page text. All requests derive ownership from
the signed-in session. Cross-origin indexing is rejected.

## Storage and limits

Graph: `(Bill)-[:HAS_EMBEDDINGS]->(DocumentEmbeddings)-[:HAS_CHUNK]->(DocumentChunk)`.
Each bill has one grouping node, with `embeddingId` equal to its bill ID. This node
holds model, dimensions, profile, status, chunk count, request ID, fingerprint, and
creation/update/embedding timestamps. Each chunk stores original page text,
page number, character position, text hash, owner/bill/group IDs, and a 768-number
vector. Pages are split into at most 1,000 Unicode
characters with a 120-character overlap; page boundaries are preserved. Long
model inputs use mean pooling instead of silently truncating text.

The limit is 128 chunks per document; exceeding it fails explicitly. Workers have
a three-minute timeout. This first implementation loads the model once per
document job, with all its chunks in one process. It does not yet cache vectors
across different documents or reuse individual changed chunks.

Neo4j 5.15+ and permission to create constraints/vector indexes are required.
The embedding workflow creates the 768-dimension cosine index `paper_nomic_chunks`
separately from general database initialization. Index incompatibility does not
block login/OCR; it fails the embedding job. An index can remain `POPULATING` after
vectors are stored; index-based search must check readiness. Semantic search and
NVIDIA answers run through the separate [document chatbot](chat.md).

Repeated indexing under the same profile is skipped. A profile change permits
reindexing; old chunks are replaced atomically after successful generation.
Original OCR remains unchanged. Bill/account deletion removes chunks, and owner
locking prevents late jobs from recreating deleted records. Request IDs prevent
stale failures/results from overwriting a newer run.

Older Bill-level metadata and direct `HAS_CHUNK` relationships remain readable.
Queueing/indexing a bill lazily moves them into its grouping node under the owner
lock, retaining ready vectors without regeneration. The old links and Bill-level
metadata are removed in the same transaction. Running the existing backfill
endpoint adopts the new structure for existing bills; status reads remain read-only.
Deletion handles both graph layouts. The demo never creates a grouping node.

## Verification

```bash
npm run test:embeddings
npm run test:python
npx tsc --noEmit
```

The Node tests mock database/model calls and the Python tests mock the model.
`npm run download:embeddings` runs a real local-model smoke check. Database mocks
do not establish live Cypher/index compatibility; verify against the target Neo4j
instance before relying on production indexing.

`npm run check:embedding-model` validates grouping, legacy migration, status writes,
ownership, and bill/account cleanup using the actual store queries against the
configured Neo4j instance. It initializes constraints/the vector index, then rolls
back all temporary fixture records. Existing document data is not migrated by this
check; use the authenticated backfill endpoint to adopt existing bills.
