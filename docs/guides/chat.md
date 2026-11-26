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

Each request first goes through an LLM query planner. It translates natural
language into a validated plan with a fixed vocabulary: count, list, total,
search, summary, or clarification. The planner receives the question, bounded
history, and current UTC date; it receives no OCR or database credentials and
cannot generate executable queries. Invalid plans retry once and then fail
without falling back to semantic retrieval.

Counts, lists, totals, rankings, and grouped comparisons execute against saved
bill metadata with fixed, owner-scoped database queries. Supported filters are
bill-date months/years/ranges, vendor, exact invoice number/filename, currency,
and saved payment balance. Listings can sort by bill date or total amount;
counts/totals can group by month, year, vendor, or currency. Amount rankings across
currencies require narrowing to one currency. Monetary sums retain separate
currencies and decimal arithmetic. They never infer payment from an invoice total.

Saved-field completeness uses the same structured query path. Missing/present
checks support vendor, bill date, currency, total amount, bill number, filename,
and balance due. Checks inspect raw saved values before display fallbacks:
null, empty, and whitespace-only values are missing; numeric zero is present.
Completeness is distinct from validity: a nonempty malformed date is present,
but remains unusable for date calculations. Multiple checks support AND/OR and
combine with other metadata filters. A vendor omitted from an OCR excerpt does
not mean the saved vendor is missing. Unsupported fields require clarification.

Month questions refer to **bill date**, not a service period or a month appearing
in OCR billing history. A month without a year searches that month across all
years. For example, an August 2012 bill matches “files from August”; a November
2026 invoice mentioning August in its usage table does not. Unknown/invalid bill
dates are excluded from date calculations with an explicit notice. Original OCR
date strings are not guessed or reparsed for these calculations.

Unfiltered counts use the full database count. Other metadata calculations read
up to 10,000 distinct owned bills and refuse oversized scopes instead of reporting
partial totals. Display limits never limit aggregate counts. At most 100 listing
rows and five example files for a filtered count are shown. Unsupported filters
(such as upload date, item-content counts, or amount thresholds) ask for a
clarification rather than dropping a condition or counting retrieved snippets.
Filtered text searches and summaries apply metadata filters before retrieval.

"Summarize all my documents" and "Summarize this file" use every indexed chunk in
the chosen scope, rather than semantic top-k. Complete summaries require all
documents to have searchable text ready and at most 40 chunks/40,000 characters;
larger or incomplete scopes return an explicit explanation instead of a partial
summary. Other text questions retain the semantic retrieval workflow below.

```text
Question + recent conversation
  -> authenticated server request
  -> validated query plan
  -> structured metadata query OR document-text retrieval
  -> for text retrieval: local Nomic search_query embedding (768 dimensions)
  -> exact cosine comparison inside the owner's filtered Neo4j graph
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

Chat requests use the typed `ChatClient` contract in
[`provider.ts`](../../lib/server/chat/provider.ts), implemented by
`OpenRouterChatClient` and exposed as `chatClient`. Callers supply messages,
generation options and cancellation via `chatClient.complete()`. The client owns
credentials, model selection, attribution, serialization, JSON-feature fallback,
network retries, quota handling and completion-envelope parsing. It returns
normalized text, model and finish reason. The planner still validates plan JSON;
the answer generator still validates answer JSON and citations. The low-level
HTTP function is private to the client.

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
  complex references can require restating the document/product. The planner
  decides whether the question is a follow-up or a new collection request.
- Retrieval requires matching owner/bill/group identifiers, a ready current
  embedding profile, the Nomic model, and 768-dimensional vectors. At most six
  chunks of at most 1,000 characters reach the answer model.
- No searchable bills or no matching chunks returns an explanation without an
  answer-generation call (planning still calls OpenRouter). Responses include ready/total bill counts so the panel can indicate
  incomplete indexing. Ready blank bills do not count as searchable.
- The model receives retrieved text, filenames/pages, the current question, and
  bounded history. It is instructed to treat documents/history as untrusted data,
  answer only from current evidence, and cite source IDs. Unknown source IDs,
  malformed JSON, and truncated responses are rejected. These checks validate
  reference integrity, not whether every generated claim is factually entailed.
- Source cards expand to display the exact excerpt used. They do not imply the
  original upload file is retained; source snapshots remain the saved OCR.
- Retrieved chunks are candidates. The answer model is instructed to report only
  relevant matches and cite only their supporting excerpts. Product-presence
  questions omit unrelated bills and nonmatches unless the user asks for a
  comparison or exclusions. When retrieval returns multiple bills, a separate
  relevance-selection call chooses supporting excerpts before answer generation.
  Only selected excerpts reach the answer-generation call; no relevant evidence
  returns a no-match response without generating an answer. Single-bill retrieval
  skips this extra call. Explicit comparisons and exclusions also keep their
  retrieved context; complete summaries retain their full source scope.
  Source selection still depends on the model; it is not a deterministic
  guarantee of semantic correctness.
- Semantic retrieval cannot guarantee complete account totals/counts, comparisons,
  or newest/oldest rankings. The planner routes these operations to structured
  metadata calculations. Unsupported operations require clarification.
- One active request per user, at most two per process, and ten requests per user
  per minute. These controls are process-local, not distributed rate limits.
- Answer calls request JSON mode plus OpenRouter response healing. Complete JSON
  wrapped in prose/fences and text-content arrays are supported. Malformed,
  truncated, or invalidly cited responses get one automatic retry with stricter
  formatting instructions. Independently, the shared client retries HTTP 400 once
  without optional JSON features, preserving the caller's messages and budget.
  Both answer-format attempts enforce the same local source-reference checks;
  unchecked prose and reasoning fields are never returned as answers.
- Successful plans are cached in memory for five minutes, scoped by authenticated
  owner, API key/model, question, history and current UTC date (at most 256 plans).
  Only interpretation is cached; database results are always read again. Failed
  plans are not cached. New questions still require a planner call.
- Planning has a shared 30-second timeout across its two formatting attempts and
  a 1,800-token output budget. Relevance selection and answer attempts share a 60-second
  timeout and have output budgets of 2,400 tokens
  initially and 3,200 on the retry. Retrieval/embeddings are not repeated. The local
  worker's existing three-minute bound applies to question embeddings. Aborting a
  request cancels local inference and the answer call when their signals propagate.
- Provider calls retry transient 429/502/503/504 responses at most twice, honoring
  `Retry-After` (including HTTP dates). Waits exceeding eight seconds are returned
  promptly instead of retrying too early; cancellation also interrupts backoff.
  Exhausted daily free-model quotas are not retried. They return a specific error
  code, reset time when available, and a `Retry-After` header. Repeated free-model
  calls on the same exhausted key are suppressed for at most one minute, allowing
  recovery after a credit/quota change. This does not block another key or a paid
  model; the app does not automatically switch to paid models. Free-model daily
  quotas are account-wide; changing free models cannot restore them. Increase
  the OpenRouter quota or wait for reset to restore new answers.

Chat questions, question vectors, and answers aren't persisted by the application.
The panel keeps the conversation in memory until reset or reload; closing and
reopening it preserves that tab's conversation. **New chat** cancels the current
request and clears the panel. Responses use `Cache-Control: no-store`. The question,
bounded history, and selected source text go to the configured external provider; its own
data handling terms still apply. Nothing calls the temporary embedding demo.

## Verification

```bash
npm run test:chat
npm run check:chat-planner
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

Merchant references are matched against owner-scoped saved vendor/customer names anywhere in the question, with case and common punctuation normalized. This includes a merchant-name reply after a clarification, such as `find out Swaad Rasoi Family Restaurant this bill`. Invoice references also accept `CH-3213 this is the bill number`, `The bill number is CH-3213`, and a standalone identifier. Multiple matching invoices still require a choice and list the matching filenames/numbers. Descriptive searches are allowed to reach retrieval rather than repeatedly requesting a reference; a genuinely unspecified `this bill` still needs context. An explicit document scope or new search does not add the preceding failed invoice reference to the query embedding.

Verified on 2026-11-24 with the exact restaurant question and the preceding failed-number clarification: the live local-embedding/NVIDIA pipeline selected bill SR-58213, returned its items and ₹1,187 total with three matching sources, and used only read-only database queries. The chat suite includes six added routing regressions (24 tests total). No bill records or embeddings were modified by this verification.
