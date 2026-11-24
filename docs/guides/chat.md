# Document chatbot

The dashboard's **Ask your docs** panel calls `POST /api/chat`. It answers from
saved OCR chunks across the signed-in user's ready bills:

The user only chats; there is no document selector. Questions search all owned
documents by default. Invoice numbers, full filenames, and document-name references
resolve against owned metadata automatically. A unique match restricts the question
to that bill; ambiguous matches ask a clarification in the chat. An unknown explicit
invoice/filename reference does not silently answer from another document.

The response carries an internal `contextBillId` in browser memory for follow-ups
such as "What about its shipping?". It is revalidated against ownership for every
request. New invoice references replace context; collection-wide count/list/summary
questions reset it. **New chat** clears context. Resolution is heuristic, so unclear
or complex references may require restating the invoice number or filename. Both
single-document and collection questions use direct requests, not Inngest.

Simple count, filename-list, and total questions use predefined database queries
within the selected scope, even if embeddings aren't ready. Examples include
"How many bills are there?", "List down the uploaded file names", and "What is my
total spending?". Totals sum saved document totals using decimal integer arithmetic,
keep known currencies separate, and disclose exclusions for missing/ambiguous
currencies or amounts. They do not infer that invoices are paid. Totals are limited
to 10,000 bills per request; filename answers show at most 100 with an explicit
notice when there are more. Users can narrow a question by naming an invoice/file.

The question router recognizes conservative English forms. Questions with extra
filters such as "unpaid" or "this month" do not silently use an unfiltered global
count/total; they fall back to the text workflow and may require clarification.

"Summarize all my documents" and "Summarize this file" use every indexed chunk in
the chosen scope, rather than semantic top-k. Complete summaries require all
documents to have searchable text ready and at most 40 chunks/40,000 characters;
larger or incomplete scopes return an explicit explanation instead of a partial
summary. Other text questions retain the semantic retrieval workflow below.

```text
Question + recent conversation
  -> authenticated server request
  -> local Nomic search_query embedding (768 dimensions)
  -> exact cosine comparison inside the owner's Neo4j graph
  -> up to six relevant chunks
  -> configured NVIDIA model through OpenRouter
  -> answer and expandable document/page evidence
```

## Configuration

Use the existing local Nomic setup and indexed bills described in
[local embeddings](embeddings.md). The question workflow runs directly in the
request; it doesn't need an Inngest job. New-document indexing still uses Inngest.

Answer generation uses `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. This project's
configured NVIDIA model is reused without a separate NVIDIA API integration.
Optionally set `OPENROUTER_CHAT_MODEL` to use a different answer model without
changing financial extraction. `OPENROUTER_APP_URL`/`OPENROUTER_APP_NAME` supply the
existing provider attribution settings.

`CHAT_MIN_SIMILARITY` optionally changes the default cutoff of `0.75`. This is a
Neo4j cosine score, not a calibrated probability or guaranteed relevance boundary.
Tune it with representative queries; a stronger ranking does not prove that a
chunk answers the question. Sources below the cutoff are excluded before calling
the answer model. The current workflow deliberately uses exact graph-scoped
comparison rather than the global vector index, so other users' vectors cannot
displace a user's matches before authorization filtering. This requires Neo4j
5.18+ and does not provide ANN scalability for large user libraries.

## Behavior and limits

- Questions: 1–1,000 Unicode characters. Request bodies: at most 8,192 bytes.
- History: up to six user/assistant entries, each at most 1,000 characters, at most
  4,000 characters combined. The interface sends the last four bounded entries
  and drops older entries if needed to stay within the request byte budget.
- Follow-up retrieval includes at most 500 characters from the previous user
  question alongside the current question. It does not run an extra model rewrite;
  complex references can require restating the document/product.
- Retrieval requires matching owner/bill/group identifiers, a ready current
  embedding profile, the Nomic model, and 768-dimensional vectors. At most six
  chunks of at most 1,000 characters reach the answer model.
- No searchable bills or no matching chunks returns an explanation without calling
  OpenRouter. Responses include ready/total bill counts so the panel can indicate
  incomplete indexing. Ready blank bills do not count as searchable.
- The model receives retrieved text, filenames/pages, the current question, and
  bounded history. It is instructed to treat documents/history as untrusted data,
  answer only from current evidence, and cite source IDs. Unknown source IDs,
  malformed JSON, and truncated responses are rejected. These checks validate
  reference integrity, not whether every generated claim is factually entailed.
- Source cards expand to display the exact excerpt used. They do not imply the
  original upload file is retained; source snapshots remain the saved OCR.
- Semantic retrieval cannot guarantee complete account totals/counts, comparisons,
  or newest/oldest rankings. The model is instructed not to guess them. The direct
  record-query routes above handle supported unfiltered counts/lists/totals;
  filtered calculations and ranked comparisons aren't implemented.
- One active request per user, at most two per process, and ten requests per user
  per minute. These controls are process-local, not distributed rate limits.
- Answer calls request JSON mode plus OpenRouter response healing. Complete JSON
  wrapped in prose/fences and text-content arrays are supported. Malformed,
  truncated, or invalidly cited responses get one automatic retry with stricter
  formatting instructions. If a provider rejects optional JSON mode with HTTP 400,
  that retry omits it. Both attempts enforce the same local source-reference checks;
  unchecked prose and reasoning fields are never returned as answers.
- Answer attempts share a 60-second timeout and have output budgets of 2,400 tokens
  initially and 3,200 on the retry. Retrieval/embeddings are not repeated. The local
  worker's existing three-minute bound applies to question embeddings. Aborting a
  request cancels local inference and the answer call when their signals propagate.

Chat questions, question vectors, and answers aren't persisted by the application.
The panel keeps the conversation in memory until reset or reload; closing and
reopening it preserves that tab's conversation. **New chat** cancels the current
request and clears the panel. Responses use `Cache-Control: no-store`. Only
retrieved text/history goes to the configured external answer provider; its own
data handling terms still apply. Nothing calls the temporary embedding demo.

## Verification

```bash
npm run test:chat
npm run test:embeddings
npx tsc --noEmit
npm run check:chat
```

The unit tests mock the model/database to verify request validation, owner filters,
follow-up context, no-match behavior, source-ID checks, concurrency, and safe
errors. `check:chat` uses real local embeddings, Neo4j, and the configured answer
model with two synthetic invoices. It checks citations across both bills and
owner isolation. Only synthetic sources are sent to the answer provider by that
check. Temporary graph data is rolled back; schema initialization is retained.
