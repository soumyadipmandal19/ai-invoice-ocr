# Paper to Text API Reference

This is the single API reference for authentication, document extraction, background job status, saved bills, database health, and Inngest integration.

The website's
signup and sign-in forms call `/api/auth/signup` and `/api/auth/login` directly
using same-origin JSON requests. On success the browser saves the session cookie
and the page navigates to `/workspace/dashboard`; API errors appear inline without clearing
the form. External clients can call the same endpoints below. Dashboard sign-out
uses a Server Action that revokes the same database-backed session.

## Endpoint overview

| Method | Endpoint | Purpose | Authentication |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | Create an account and session | Public |
| POST | `/api/auth/login` | Sign in | Public |
| GET | `/api/auth/me` | Read the current user | Session cookie |
| POST | `/api/auth/logout` | Revoke the current session | Cookie when available |
| DELETE | `/api/auth/me` | Delete the current account and its data | Session cookie |
| POST | `/api/extract` | Extract PDF/image text and queue classification | Session cookie |
| GET | `/api/classifications/{id}` | Read an owned background job | Session cookie |
| GET | `/api/bills` | List saved documents | Session cookie |
| POST | `/api/bills` | Retry saving an organized job | Session cookie |
| GET | `/api/bills/{id}` | Read saved OCR, AI, and workbook snapshots | Session cookie |
| DELETE | `/api/bills/{id}` | Delete an owned bill and its child data | Session cookie |
| POST | `/api/embeddings` | Queue local embeddings for saved bills | Session cookie |
| GET | `/api/embeddings?billId=UUID` | Read owned embedding progress | Session cookie |
| POST | `/api/embeddings/demo` | Generate a temporary vector without saving it | Session cookie |
| POST | `/api/chat` | Ask questions about indexed bills with source references | Session cookie |
| GET | `/api/chat/documents` | List owned document choices for chat | Session cookie |
| GET | `/api/documents` | List file-library metadata and folder counts | Session cookie |
| GET | `/api/health/neo4j` | Check database connectivity | Session cookie |
| GET, POST, PUT | `/api/inngest` | Inngest SDK integration endpoint | Inngest protocol/configuration |

For setup and the workflow diagram, see the [project README](../../README.md).

## Base URL and prerequisites

Local base URL: `http://localhost:3000` (use the port printed by your dev server).
For deployment, replace it with your website's HTTPS origin.

Start the application with `npm run dev`. The server needs valid `NEO4J_URI`,
`NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE` settings in `.env.local`.
`npm run check:neo4j` checks those credentials. On first authentication use, the
server also creates uniqueness constraints; the database account must have
permission to create them.

Extraction also requires `PYTHON_EXECUTABLE` and English OCR language data through
`TESSDATA_PREFIX`. Background financial processing requires `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, and a running local Inngest Dev Server or configured production
Inngest integration. See the [environment template](../../.env.example).

Database credentials are server configuration. Never include them in a frontend
request, Postman request body, or authentication header.

## Authentication request and session conventions

| Item | What the caller sends |
| --- | --- |
| Signup/login/delete-account body | A JSON object with the fields specified below |
| Signup/login/delete-account header | `Content-Type: application/json` |
| Path/query parameters | None for these endpoints |
| API key / Bearer token | None; these endpoints use cookie sessions |
| Authenticated requests | The `paper-text-session` cookie received during signup/login |
| Browser Origin | Automatically supplied by the browser for mutations; it must match the allowed website origin |

Signup and login return `Set-Cookie` and sign the user in immediately. The
session cookie lasts seven days, is `HttpOnly`, uses `SameSite=Lax`, and has
`Path=/`. Production cookies also use `Secure`, so production calls require
HTTPS. The token is not included in the JSON response and cannot be read by
browser JavaScript.

Browsers retain/send same-origin cookies automatically. cURL needs a cookie jar;
Postman normally maintains cookies automatically. Successful signup/login
replaces and revokes the session supplied by that caller. Sessions in other
browsers are not revoked. Responses include `Cache-Control: no-store`.

Mutation requests with a different `Origin`, or `Sec-Fetch-Site: cross-site`,
return 403. Non-browser clients may omit Origin. For a reverse proxy, configure
`AUTH_ORIGIN` on the server with the exact public origin, such as
`https://app.example.com`, without a trailing slash. Otherwise the allowed origin
is taken from the incoming request URL. Cross-origin browser clients are not
configured as a supported integration.

## Document extraction API

### POST /api/extract

Extracts text synchronously with the Python worker, then queues background LLM
classification and financial organization. A successful extraction response does
not mean that LLM processing or Neo4j saving has finished.

**Authentication:** `paper-text-session` cookie from signup/login.
**Content-Type:** `multipart/form-data` with a boundary. Let cURL or the browser
set this header when using a form upload.

| Form field | Required | Description |
| --- | --- | --- |
| `file` | Yes | PDF, PNG, JPG/JPEG, WebP, or BMP file; extension must match its signature |
| `forceOcr` | No | String `true` forces full-page OCR; otherwise OCR is selected automatically |

Limits: 10 MB per file, 1–20 PDF pages, 20 million pixels per still image,
500,000 extracted characters, and a 120-second worker timeout. Animated images
and password-protected PDFs are rejected. The multipart request limit is the
file limit plus 128 KiB of overhead. Two extraction requests can run per server
process; additional requests receive 429.

```bash
curl -i -b /tmp/paper-text-cookies.txt \
  -X POST http://localhost:3000/api/extract \
  -F 'file=@/path/to/invoice.pdf'
```

Optional full OCR: add `-F 'forceOcr=true'`.

Before OCR, the server hashes the file bytes with SHA-256 and reserves the hash
for the signed-in user in Neo4j. Identical bytes (even under a different filename)
return **409 Conflict**, without starting another extraction or workflow:

```json
{
  "duplicate": true,
  "jobId": "c24594ac-93d8-4db2-8e6a-b01953e47eaa",
  "message": "This file is already saved. Opened the existing document."
}
```

The response includes `bill` (the saved bill, workbook, and OCR) when available,
or `document` (the existing extraction with its classification reference) for a
pending job. Clients should reuse that document instead of adding another row.
During extraction, only the message and job ID may be available; wait and retry
to open the result. `forceOcr` does not bypass duplicate protection.

Reservations are owner-scoped and atomic across server instances. Failed
extraction/submission releases the reservation. Failed jobs without staged
financial output can be uploaded again; staged financial results retain their
existing job for save retries. Saved results remain deduplicated after temporary
jobs expire. Deleting a saved bill or account removes its reservation. Files
saved before this feature have no hash reservation and are not retroactively
matched; rescanned or otherwise byte-different copies are treated as new files.

HTTP **200 OK**, with a minimal illustrative extraction:

```json
{
  "sourceFileName": "invoice.pdf",
  "pageCount": 1,
  "pages": [
    { "page": 1, "text": "Invoice\nTotal: 118.00", "method": "text" }
  ],
  "structured": {
    "schemaVersion": 1,
    "fields": [],
    "tables": [],
    "warnings": []
  },
  "classification": {
    "jobId": "c24594ac-93d8-4db2-8e6a-b01953e47eaa"
  }
}
```

Page `method` is `text`, `ocr`, `mixed`, or `blank`. Structured fields/tables
are candidate detections requiring review. Full shapes and runtime validation
are defined in [types/extraction/result.ts](../../types/extraction/result.ts).

If classification setup or submission fails, extraction can still return 200
with `classification: { "error": "..." }` instead of a job ID. Do not poll unless
`classification.jobId` is present. The upload is temporary and removed after the
request; local job files preserve extracted data for background processing.

| Status | Meaning |
| --- | --- |
| 200 | Extraction succeeded; inspect `classification` for background submission status |
| 400 | Missing/empty file, invalid multipart data, unsupported extension, or signature mismatch |
| 401 | No authenticated session |
| 409 | Identical file already uploaded by this user; inspect `duplicate`, `jobId`, and optional `bill`/`document` |
| 413 | File or multipart body exceeds its limit |
| 422 | Python validation/OCR failure, including unreadable/protected PDF or page/output limits |
| 429 | Two extraction requests are already active in this process |
| 500 | Python setup, worker, or unexpected extraction failure |
| 503 | Duplicate check/database unavailable; extraction has not started |
| 504 | Worker processing timed out |

Handled extraction errors use `{ "error": "..." }`; duplicate responses use the shape above. Authentication/backend
failures before the route's processing block can use framework error responses.
The extraction route does not call the shared Origin validator used by auth and
bill mutations. It uses the application's cookie session and its browser cookie
policy. Success responses disable caching.

### Browser upload example

```js
const form = new FormData();
form.append("file", fileInput.files[0]);
const response = await fetch("/api/extract", {
  method: "POST",
  credentials: "same-origin",
  body: form,
});
const extraction = await response.json();
if (!response.ok) throw new Error(extraction.error);
const jobId = extraction.classification?.jobId;
```

## Background job status API

### GET /api/classifications/{id}

Returns a temporary classification job owned by the signed-in uploader.
Use `classification.jobId` from extraction as `id`. No request body or
Content-Type header is needed. The dashboard polls pending jobs once per second.

```bash
curl -i -b /tmp/paper-text-cookies.txt \
  http://localhost:3000/api/classifications/c24594ac-93d8-4db2-8e6a-b01953e47eaa
```

HTTP **200 OK**, pending example:

```json
{
  "id": "c24594ac-93d8-4db2-8e6a-b01953e47eaa",
  "status": "pending",
  "expiresAt": 1806000000000
}
```

`expiresAt` is a Unix timestamp in milliseconds; the example is illustrative.

| Response field | Meaning |
| --- | --- |
| `id` | Job UUID |
| `status` | `pending`, `complete`, or `failed` |
| `expiresAt` | Expiry, set to 24 hours after job creation |
| `result` | Available classification: document type, financial flag, sampled byte count, model, and optional token usage |
| `workbook` | Organized financial workbook when staged or completed |
| `persistence` | When present, storage status `pending`, `saved`, or `failed`, with `billId` after saving |
| `error` | Failure message when available |

`ownerUserId` is omitted from the public response. A job may still be pending
while its result/workbook are staged. A completed financial job is saved in
Neo4j; a completed `other`/`unknown` job has no financial workbook or bill.
A failed database save may retain a staged workbook eligible for `POST /api/bills`.
Stop polling on `complete` or `failed`.

| Status | Meaning |
| --- | --- |
| 200 | Owned job returned |
| 401 | No authenticated session |
| 404 | Invalid UUID, missing/expired job, another user's job, or legacy job without an owner |
| 503 | Job status could not be read |

Responses disable caching. Expired job files do not remove saved graph records;
use the bill endpoints for persistent history. The full original OCR and AI
snapshots are read through `GET /api/bills/{id}`, not this polling endpoint.

## Database health API

### GET /api/health/neo4j

Checks server-side Neo4j connectivity for a signed-in user. No request body,
Content-Type header, or database credentials should be supplied by the caller.

```bash
curl -i -b /tmp/paper-text-cookies.txt \
  http://localhost:3000/api/health/neo4j
```

HTTP **200 OK**:

```json
{"connected":true}
```

A missing session returns 401. A failure inside the connectivity check returns
503 with `connected: false` and an error message. Since session lookup also uses
Neo4j and occurs before that check, a database outage can instead cause a
framework error during authentication. This endpoint checks connectivity only;
it does not write bill data. Responses created by the route disable caching.

## Inngest integration endpoint

### GET / POST / PUT /api/inngest

This endpoint is served by `inngest/next` for function discovery, registration,
and execution. It is an SDK protocol endpoint, not a user-facing JSON endpoint
for manually submitting PDFs or classification jobs. Its response shapes and
request authentication are managed by the SDK; application session cookies are
not its authentication mechanism.

Local development: run `npm run dev:inngest` alongside the app with
`INNGEST_DEV=1`. The CLI connects to `http://localhost:3000/api/inngest` by default.
Production: disable development mode, configure `INNGEST_EVENT_KEY` and
`INNGEST_SIGNING_KEY`, and sync the endpoint with Inngest Cloud.

Registered functions:

| Function | Event trigger | Purpose |
| --- | --- | --- |
| `configuration-check` | `app/inngest.test` | Verify function registration and step execution |
| `classify-document` | `document/classification.requested` | Classify extracted text, map financial data, build the workbook, and persist the result |

The server submits classification events with a job ID and a bounded text
sample after extraction. Full workflow details are in the
[README](../../README.md#how-the-workflow-works) and
[implementation](../../lib/inngest/functions.ts).

## POST /api/auth/signup

Creates an application user in Neo4j and establishes a session. No existing login
is required.

### Headers and fields

Required header: `Content-Type: application/json`.

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `name` | string | Yes | Trimmed; 2–80 characters after trimming |
| `email` | string | Yes | Valid email format; trimmed and lowercased; at most 254 characters after normalization; must be unique |
| `password` | string | Yes | 8–128 characters; whitespace is preserved |
| `confirmPassword` | string | No | If supplied, must exactly match `password` |

```json
{
  "name": "Sam Example",
  "email": "sam@example.com",
  "password": "example-password-123",
  "confirmPassword": "example-password-123"
}
```

### Successful response

HTTP **201 Created**, plus the session `Set-Cookie` header:

```json
{
  "user": {
    "id": "c24594ac-93d8-4db2-8e6a-b01953e47eaa",
    "name": "Sam Example",
    "email": "sam@example.com"
  }
}
```

The ID shown is an example; the server generates each user's actual ID. Password
hashes, salts, and session tokens are never included in this JSON.

### cURL example

This creates a real account. Replace the sample email and password when trying it.
The file passed to `-c` stores the session cookie for subsequent calls.

```bash
curl -i -c /tmp/paper-text-cookies.txt \
  -X POST http://localhost:3000/api/auth/signup \
  -H 'Content-Type: application/json' \
  --data '{"name":"Sam Example","email":"sam@example.com","password":"example-password-123","confirmPassword":"example-password-123"}'
```

### Endpoint-specific errors

- **400:** Missing/invalid fields or mismatched password confirmation.
- **409:** Email already exists, including differences only in casing or surrounding whitespace.
- Shared request and availability errors are listed below.

## POST /api/auth/login

Checks existing credentials and establishes a new session. No existing login is
required. It does not create an account.

### Headers and fields

Required header: `Content-Type: application/json`.

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `email` | string | Yes | Same normalization and format rules as signup |
| `password` | string | Yes | 8–128 characters; must match the account's password |

```json
{
  "email": "sam@example.com",
  "password": "example-password-123"
}
```

### Successful response

HTTP **200 OK**, plus a new session `Set-Cookie` header:

```json
{
  "user": {
    "id": "c24594ac-93d8-4db2-8e6a-b01953e47eaa",
    "name": "Sam Example",
    "email": "sam@example.com"
  }
}
```

### cURL example

`-b` sends an existing cookie, if present. `-c` saves the replacement cookie.

```bash
curl -i -b /tmp/paper-text-cookies.txt -c /tmp/paper-text-cookies.txt \
  -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  --data '{"email":"sam@example.com","password":"example-password-123"}'
```

### Endpoint-specific errors

- **400:** Missing fields, invalid email, or a password outside the length limits.
- **401:** Unknown email or incorrect password. Both return the same message:

```json
{"error":"Email or password is incorrect."}
```

## GET /api/auth/me

Returns the user associated with the current session.

**Authentication:** Send the session cookie from signup/login. No body, query
parameters, or `Content-Type` header is required.

```bash
curl -i -b /tmp/paper-text-cookies.txt \
  http://localhost:3000/api/auth/me
```

HTTP **200 OK**:

```json
{
  "user": {
    "id": "c24594ac-93d8-4db2-8e6a-b01953e47eaa",
    "name": "Sam Example",
    "email": "sam@example.com"
  }
}
```

A missing, invalid, expired, or revoked session returns HTTP **401 Unauthorized**:

```json
{"error":"Sign in to continue."}
```

Database failures return 503. A successful response does not extend the session's
expiry.

## POST /api/auth/logout

Revokes the supplied session and clears its browser cookie. It does not delete
the user account or revoke sessions in other browsers.

**Authentication:** Send the current session cookie to revoke that session.
No body or `Content-Type` header is required. Calling without a cookie also
succeeds, making repeated logout calls safe.

```bash
curl -i -b /tmp/paper-text-cookies.txt -c /tmp/paper-text-cookies.txt \
  -X POST http://localhost:3000/api/auth/logout
```

HTTP **200 OK**, plus a clearing `Set-Cookie` header with `Max-Age=0`:

```json
{"success":true}
```

After logout, calling `/api/auth/me` with the same cookie jar returns 401.
Cross-origin requests return 403; backend failures return 503.

## DELETE /api/auth/me

Permanently deletes the currently signed-in account and all of its login sessions
in Neo4j, then clears the current browser's session cookie. Sessions on other
devices become invalid immediately. The server authorizes deletion from the
session cookie; callers cannot select an account with a user ID or email.
Authorization and deletion happen in one database transaction.

**Authentication:** Valid `paper-text-session` cookie. Required header:
`Content-Type: application/json`. The same Origin rules apply as to signup/login.

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `confirmation` | string | Yes | Must be exactly `DELETE` (case-sensitive) |

Request body:

```json
{"confirmation":"DELETE"}
```

HTTP **200 OK**, plus a clearing `Set-Cookie` header with `Max-Age=0`:

```json
{"success":true}
```

The dashboard avatar opens **Profile details** and **Delete profile** options.
Profile details shows the current user's name and email. Delete profile
opens a confirmation dialog; the user types `DELETE` before submitting. Success
navigates to `/signin`; failed requests keep the dialog open and show an error.

The following command **permanently deletes the account associated with the
cookie jar**. Use only a disposable account when testing:

```bash
curl -i -b /tmp/paper-text-cookies.txt -c /tmp/paper-text-cookies.txt \
  -X DELETE http://localhost:3000/api/auth/me \
  -H 'Content-Type: application/json' \
  --data '{"confirmation":"DELETE"}'
```

Endpoint errors:

- **400:** Missing or incorrect confirmation, or malformed JSON.
- **401:** Missing, invalid, revoked, or expired session; nothing is deleted.
- **403:** Origin mismatch or cross-site request.
- **413 / 415:** Body too large or unsupported content type.
- **503:** Database failure; no successful deletion is reported and the cookie
  is not cleared.

This endpoint removes the account, all its sessions, and its saved Bill/BillItem, OCRExtraction,
and LLMResult nodes in Neo4j. Temporary classification files follow their existing 24-hour
expiry policy. It does not remove exports already downloaded by the user. No password re-entry is required;
access is authorized by the current valid session and explicit confirmation.
After deletion, that email can be used to register a new account with a new ID.

## Calling from the frontend

This example logs in from a page served by the same website. Use the same request
shape for signup, adding `name` and optionally `confirmPassword`.

```js
const response = await fetch("/api/auth/login", {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "sam@example.com",
    password: "example-password-123",
  }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.error);
console.log(data.user);
```

Use the saved cookie to get the user or log out; no token needs to be copied:

```js
const response = await fetch("/api/auth/me", {
  credentials: "same-origin",
});
const data = await response.json();
if (!response.ok) throw new Error(data.error);
console.log(data.user);

const logoutResponse = await fetch("/api/auth/logout", {
  method: "POST",
  credentials: "same-origin",
});
const logoutData = await logoutResponse.json();
if (!logoutResponse.ok) throw new Error(logoutData.error);
```

Browsers manage the `Origin` and cookie headers. Do not manually set them or put
the session token in localStorage.

## Calling from Postman

1. Choose the method and full endpoint URL from this reference.
2. For signup/login, select **Body → raw → JSON** and paste the relevant JSON
   example. Ensure `Content-Type: application/json` is set.
3. Leave **Authorization** as **No Auth**. Send signup/login and inspect the
   `Set-Cookie` response header or Postman's cookie manager.
4. Call `GET /api/auth/me` on the same host and port. Keep using the same hostname:
   `localhost` and `127.0.0.1` do not share cookies.
5. Call `POST /api/auth/logout` with no body, then call `/me` again to check for 401.

## Authentication errors and limits

API errors use this envelope:

```json
{"error":"Human-readable error message."}
```

| Status | Applies to | Meaning / action |
| --- | --- | --- |
| 400 | Signup/login/delete-account | Invalid fields, empty body, malformed JSON, or JSON that is not an object; fix the request |
| 401 | Login/me/delete-account | Incorrect credentials or no valid session; log in with valid credentials |
| 403 | All mutation endpoints | Origin mismatch or cross-site browser request; use the same website origin |
| 409 | Signup | Email already registered; use login |
| 413 | Signup/login/delete-account | Body exceeds 8,192 bytes |
| 415 | Signup/login/delete-account | Missing/wrong Content-Type; send `application/json` |
| 429 | Signup/login | Attempt limit reached; wait for the 15-minute attempt window to reset |
| 503 | All | Database unavailable or auth backend busy; retry later and check server configuration |

Signup/login share a limit per normalized email: ten attempts in a 15-minute
window per server process; a successful authentication clears that email's
counter. Validation failures do not consume attempts. At most two authentication
operations run concurrently per process; additional calls receive 503. Counters
are in memory and are not shared between server instances. A full attempt map
also rejects new emails with 429. No `Retry-After` header is currently returned.
Unsupported HTTP methods return the framework's 405 response; it is not
necessarily in the JSON error envelope above.

Email verification, password reset, and a session refresh endpoint are not implemented. Existing local-file accounts are not migrated to
Neo4j automatically.

## Authentication implementation map

- Routes: [`app/api/auth/`](../../app/api/auth).
- HTTP validation/responses: [`auth/handlers.ts`](../../lib/server/auth/handlers.ts).
- Credentials and rate limits: [`auth/service.ts`](../../lib/server/auth/service.ts).
- Password hashing and database queries: [`auth/store.ts`](../../lib/server/auth/store.ts).
- Cookies and current-user helper: [`auth/session.ts`](../../lib/server/auth/session.ts).
- Database models/constraints: [`database/schema.ts`](../../lib/server/database/schema.ts).
- Public user response type: [`types/auth/user.ts`](../../types/auth/user.ts).
- Automated API tests: [`tests/auth.test.mjs`](../../tests/auth.test.mjs), run with `npm run test:auth`.

Update this reference when endpoint behavior changes. The tests use a mocked
Neo4j driver and do not create accounts in Aura.

## Bills persistence API

### Automatic save after Inngest

No extra browser request is needed for a new upload. `POST /api/extract` binds
the job to the authenticated user's ID on the server. Inngest classifies and
organizes the document, stages the financial workbook, then runs
`save-bill-to-neo4j`. Only after that database transaction commits does the job
become `complete` and its temporary OCR input get removed.

The graph is:

```text
(User)-[:UPLOADED]->(Bill)-[:HAS_ITEM]->(BillItem)
```

`Bill.billId` is the classification job's UUID. Item IDs are deterministic
`<billId>:<itemNumber>` strings. Uniqueness constraints and transactional `MERGE`
make workflow retries and repeated API calls safe. Initial records are marked
**Needs review**. The full financial workbook (including source sheets),
classification, original formatting, and normalization warnings are retained as
JSON/string properties alongside the normalized bill/item properties.

Only unambiguous ISO dates and plain decimal numbers are normalized. Grouped or
currency-prefixed amounts and ambiguous dates remain available in `workbookJson`;
the normalized field is absent/null with a review warning. Confirmed zero is
preserved as zero. Percentage fields accept an optional `%` suffix. Large or
high-precision numbers are retained only in the raw workbook rather than silently
rounded into a normalized field. No accounting totals are recalculated.

OCR failures, unsupported/nonfinancial documents, or organization failures before
a workbook is staged create no Bill nodes. If database saving fails, Inngest
retries the save using its cached successful model steps. After retries are
exhausted, the local job retains the staged workbook for a manual save retry
until its 24-hour expiry. A job without an upload owner, including older jobs
created before this feature, cannot be claimed; upload the source again.

### POST /api/bills

Saves/retries saving the server-produced result belonging to the signed-in user.
It uses the same service as Inngest. This endpoint does not accept a new bill
payload or save spreadsheet corrections.

**URL:** `http://localhost:3000/api/bills` locally; replace the origin/port as needed.

**Authentication:** The `paper-text-session` cookie set by login/signup.

**Headers:** `Content-Type: application/json`. Browser calls must be same-origin;
the same Origin checks and optional `AUTH_ORIGIN` setting apply as for auth APIs.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `jobId` | string | Yes | The UUID in `classification.jobId` returned by `/api/extract` |

Example request (replace the example UUID with your actual job ID):

```json
{"jobId":"c24594ac-93d8-4db2-8e6a-b01953e47eaa"}
```

The server loads the staged workbook itself. Fields such as `ownerUserId`,
`totalAmount`, or `items` supplied by a caller cannot change the stored result.
The job must still exist locally, belong to the signed-in user, and have a
successfully organized financial workbook. A staged save whose Inngest retries
failed can be saved through this endpoint; no further model calls are made.

HTTP **200 OK** for both initial save and an idempotent repeat:

```json
{
  "billId":"c24594ac-93d8-4db2-8e6a-b01953e47eaa",
  "itemCount":2,
  "status":"saved"
}
```

No new cookie is set. The existing authenticated session remains in use.
New saves require the staged original OCR and validated AI snapshots; older
staged jobs without them return 409 and must be re-uploaded.

```bash
curl -i -b /tmp/paper-text-cookies.txt \
  -X POST http://localhost:3000/api/bills \
  -H 'Content-Type: application/json' \
  --data '{"jobId":"c24594ac-93d8-4db2-8e6a-b01953e47eaa"}'
```

Frontend example for a manual retry:

```js
const response = await fetch("/api/bills", {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jobId }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
console.log(result.billId, result.status);
```

In Postman, use POST, raw JSON, and No Auth; retain the login cookie for the same
host. Do not use your Aura username/password as API credentials.

| Status | Meaning |
| --- | --- |
| 200 | Saved or already saved; same bill ID returned |
| 400 | Invalid/missing job UUID or malformed JSON |
| 401 | Not signed in |
| 403 | Origin mismatch / cross-site mutation |
| 404 | Unknown/expired job, another user's job, unowned legacy job, or deleted owner |
| 409 | No successfully organized financial workbook is ready to save |
| 413 | Request body exceeds 8,192 bytes |
| 415 | Content-Type is not application/json |
| 503 | Database or job-store failure; retry later |

Errors use `{ "error": "..." }`; all responses disable caching. Repeated saves
preserve the originally stored data and createdAt timestamp instead of overwriting
later corrections. A repeated upload creates a different job ID and therefore a
separate Bill; detecting duplicate physical bills is not implemented here.

### Status, retention, and account deletion

`GET /api/classifications/<jobId>` now requires the uploading user's session.
Foreign or legacy-unowned jobs return 404. Successful financial results include:

```json
{
  "status":"complete",
  "persistence":{
    "status":"saved",
    "billId":"c24594ac-93d8-4db2-8e6a-b01953e47eaa"
  }
}
```

This is a partial response; existing `id`, `expiresAt`, `result`, and `workbook`
fields are also returned. A staged database-save failure has job `status: failed`
and `persistence.status: failed`, while preserving the staged result. Completed
nonfinancial results have no persistence field and do not create bills.

The Bills sheet's optional **Storage** column reports the saved/failed state when the
workflow settles. The dashboard loads saved history for the signed-in user through `GET /api/bills`. Spreadsheet corrections are in-tab
edits and do not update the saved graph yet. Original files are not persisted.

Graph Bill and BillItem records outlive the temporary job files, which expire
at 24 hours. Account deletion removes the user's owned bills, items, and linked OCR/AI snapshots
in the same graph transaction as their sessions and account. Other users' data is
preserved. Temporary job files follow their existing expiry policy. A late
workflow cannot recreate a deleted user or save a new bill for that user.

### Implementation and checks

- Route: [`app/api/bills/route.ts`](../../app/api/bills/route.ts).
- HTTP handling: [`bills/handlers.ts`](../../lib/server/bills/handlers.ts).
- Shared workflow/API save service: [`bills/service.ts`](../../lib/server/bills/service.ts).
- Normalization: [`bills/normalize.ts`](../../lib/server/bills/normalize.ts).
- Transactional graph writes: [`bills/store.ts`](../../lib/server/bills/store.ts).
- Models/constraints: [`database/schema.ts`](../../lib/server/database/schema.ts).
- Workflow: [`lib/inngest/functions.ts`](../../lib/inngest/functions.ts).

Run `npm run test:bills` and `npm run test:classification` for mocked API/store/
workflow tests. To validate the graph query syntax against Aura without creating
nodes, relationships, or constraints, run:

```bash
node --env-file=.env.local scripts/database/check-bill-queries.mjs
```

## Original OCR and AI snapshots

New saved financial results include two separate, immutable snapshots:

```text
(User)-[:UPLOADED]->(Bill)-[:HAS_ITEM]->(BillItem)
                       ├─[:HAS_OCR]────────→(OCRExtraction)
                       └─[:HAS_LLM_RESULT]─→(LLMResult)
```

- `OCRExtraction.dataJson` contains the complete original extraction object before
  classification and manual edits. It preserves page text, extraction methods,
  structured fields, tables, bounding boxes, warnings, additional worker metadata,
  and the source filename supplied by the upload endpoint.
- `LLMResult.dataJson` contains `classification`, `organization` (the merged,
  validated field mapping), and `mappingResults` (the validated per-chunk results,
  including source references and available usage information).
- `LLMResult.workbookJson` contains the original AI-organized spreadsheet output.
  Existing `Bill.workbookJson` remains for compatibility.

The AI snapshot represents the validated outputs consumed by the application;
it is not the provider's entire HTTP response, prompt, or private reasoning.
Neither snapshot is modified by spreadsheet edits. The original PDF/image file
is not stored. All snapshot nodes are saved atomically with the bill/items,
reuse stable IDs on retry, and are removed when the account is deleted.

Private local `.artifacts` files stage both snapshots before saving and survive
failed save attempts for retry. These files expire with their classification job
at 24 hours. Once saved, the graph snapshots remain independently of those files.
Full OCR snapshots do not enter Inngest events or step return values.

### GET /api/bills/{id}

Returns a saved bill's original OCR response and AI output separately, plus its
original workbook. The bill must belong to the signed-in user.

| Input | Required | Description |
| --- | --- | --- |
| Path `id` | Yes | Bill UUID returned by the save result; the same as its job ID |
| Session cookie | Yes | `paper-text-session` from login/signup |
| Body, query parameters | No | None |
| Content-Type request header | No | Not required for GET |

```bash
curl -i -b /tmp/paper-text-cookies.txt \
  http://localhost:3000/api/bills/c24594ac-93d8-4db2-8e6a-b01953e47eaa
```

HTTP **200 OK** returns this structure (objects abbreviated here):

```json
{
  "billId":"c24594ac-93d8-4db2-8e6a-b01953e47eaa",
  "ocr":{
    "sourceFileName":"bill.pdf",
    "pageCount":1,
    "pages":[{"page":1,"text":"Original OCR text","method":"ocr"}],
    "structured":{"schemaVersion":1,"fields":[],"tables":[],"warnings":[]}
  },
  "llm":{
    "classification":{"documentType":"receipt","isFinancialDocument":true},
    "organization":{"receipt":{"total":"118.00"},"items":[],"warnings":[]},
    "mappingResults":[]
  },
  "workbook":{"schemaVersion":2,"sheets":[],"warnings":[]}
}
```

The actual OCR object and validated AI objects retain all of their original
stored fields; this example is shortened. The endpoint returns 400 for an invalid
UUID, 401 without a valid session, 404 for an unknown or another user's bill, and
503 for backend failure. Responses disable caching and do not expose credentials.

Older bills created before snapshots were added return `ocr: null` and
`llm: null`, while still returning their saved workbook. Missing original OCR
metadata cannot be reconstructed faithfully from a spreadsheet. Upload the
source again to capture both complete snapshots. Attempting to save an older
staged job without snapshots now returns 409 rather than inventing original data.

To inspect the nodes in Neo4j Query:

```cypher
MATCH (b:Bill)
OPTIONAL MATCH (b)-[ocrLink:HAS_OCR]->(ocr:OCRExtraction)
OPTIONAL MATCH (b)-[llmLink:HAS_LLM_RESULT]->(llm:LLMResult)
RETURN b, ocrLink, ocr, llmLink, llm
LIMIT 25;
```

To inspect the JSON properties:

```cypher
MATCH (b:Bill)-[:HAS_OCR]->(ocr:OCRExtraction),
      (b)-[:HAS_LLM_RESULT]->(llm:LLMResult)
RETURN b.billId, ocr.dataJson AS originalOCR,
       llm.dataJson AS validatedAI, llm.workbookJson AS organizedWorkbook
LIMIT 10;
```

## List the signed-in user's saved bills

### GET /api/bills

Loads saved bill workbooks and available original OCR snapshots from Neo4j for
the authenticated user. The dashboard calls this endpoint automatically on mount.
The backend obtains the user ID from the verified session and queries
`(:User {id: $ownerUserId})-[:UPLOADED]->(:Bill)`. There is no client-selectable
owner/user ID. A supplied `userId` parameter does not change which account is read.

**Authentication:** `paper-text-session` login cookie.
**Request body:** None. No Content-Type header is required.

| Query parameter | Required | Default | Rules |
| --- | --- | --- | --- |
| `offset` | No | 0 | Integer from 0 to 1000000 |
| `limit` | No | 25 | Integer from 1 to 50 |

Results are ordered by their saved `createdAt` timestamp, then Bill ID, ascending.
Each request loads at most `limit` bills. `nextOffset` is null when there is no
next page; otherwise pass that number as the next request's offset. The dashboard
loads the first 25 and provides **Load more saved documents** when needed.

```bash
curl -i -b /tmp/paper-text-cookies.txt \
  'http://localhost:3000/api/bills?offset=0&limit=25'
```

HTTP **200 OK** returns this shape (nested objects abbreviated):

```json
{
  "bills":[
    {
      "billId":"c24594ac-93d8-4db2-8e6a-b01953e47eaa",
      "sourceFile":"bill.pdf",
      "createdAt":"2026-11-22T10:00:00.000Z",
      "classification":{"documentType":"receipt","isFinancialDocument":true},
      "workbook":{"schemaVersion":2,"sheets":[],"warnings":[]},
      "ocr":{"pageCount":1,"pages":[],"structured":{"schemaVersion":1,"fields":[],"tables":[],"warnings":[]}}
    }
  ],
  "nextOffset":null
}
```

The actual stored objects retain their full fields. Empty history returns
`{ "bills": [], "nextOffset": null }`. This endpoint reads saved graph data,
so expired or deleted temporary classification jobs do not prevent restoration.
Older bills without an original snapshot return `ocr: null` and retain their
saved workbook; missing original OCR metadata is not fabricated.

| Status | Meaning |
| --- | --- |
| 200 | User's saved page, including empty history |
| 400 | Invalid offset or limit |
| 401 | Not signed in |
| 503 | Saved history could not be loaded; retry later |

All responses disable caching. Other users' bills are never returned. The read
uses parameterized Cypher and does not write bill data.

### Dashboard restoration

Saved documents populate their own tabs and the combined Bills/Bill Items
workbook. Newer records also restore original OCR views. Legacy records can open
their workbook and source sheets even without a complete OCR snapshot. Restored
records use their saved classification rather than polling expired workflow jobs.

Loading failures show a retry action, not a misleading empty account. More pages
are merged by Bill ID, preserving edits to already loaded/current-session records
and avoiding duplicates. Indices follow the loaded records' chronological order.
Spreadsheet edits still remain in the browser; this feature restores the original
saved result and does not add a correction-save API. Original PDF/image previews
are unavailable because original files are not retained.

The shared list response types are in `types/bills/responses.ts`; client restoration
and merge logic are in `lib/bills/history.ts`. Tests: `npm run test:bills` and
`npm run test:history`.

## Delete one bill and its child records

### DELETE /api/bills/{id}

Permanently deletes a bill belonging to the signed-in user and all currently
modeled child data: BillItem, OCRExtraction, LLMResult, DocumentEmbeddings,
and DocumentChunk nodes. Both `Bill → DocumentEmbeddings → DocumentChunk` and
legacy direct `Bill → DocumentChunk` links are covered. The matching owned
DocumentUpload tracking node (`User → HAS_UPLOAD`, with `jobId` equal to the
Bill ID) is also removed. Relationships are detached as each node is deleted.
The user's account, login sessions, and other bills are preserved.

The graph deletion runs atomically under an owner lock. A deleted-Bill ID marker
makes retries idempotent and blocks delayed saves from recreating the bill.
The service then removes the owner's temporary classification job/artifact
files. Embedding workers require the existing owned Bill and group before
writing results.

Audit on 2026-11-24: read-only relationship inspection and the deletion query's
matching clauses covered 4 Bills, 4 BillItems, 4 OCRExtractions, 4 LLMResults,
4 DocumentEmbeddings, 8 DocumentChunks and 1 matching DocumentUpload. All live
queries reported zero updates. The live DELETE endpoint was not called; no
existing database data was changed. `npm run test:bills` includes explicit
query-coverage checks for current/legacy embedding paths, upload tracking,
ownership, retry markers and failure handling using a mocked driver.

**Authentication:** `paper-text-session` cookie. The owner ID is read from the
verified session, never accepted from the request body.

**Path:** `id` is the saved Bill UUID. **Header:** `Content-Type: application/json`.
Same-Origin mutation checks apply.

Required body:

```json
{"confirmation":"DELETE"}
```

The value is case-sensitive. The UI sends this only after the user confirms its
**Delete bill** popup; unlike account deletion, no text entry is required.

HTTP **200 OK**:

```json
{
  "success":true,
  "billId":"c24594ac-93d8-4db2-8e6a-b01953e47eaa"
}
```

The following command permanently deletes the selected bill. Use a disposable
record when testing:

```bash
curl -i -b /tmp/paper-text-cookies.txt \
  -X DELETE http://localhost:3000/api/bills/c24594ac-93d8-4db2-8e6a-b01953e47eaa \
  -H 'Content-Type: application/json' \
  --data '{"confirmation":"DELETE"}'
```

| Status | Meaning |
| --- | --- |
| 200 | Deleted; repeating an owned deletion also succeeds |
| 400 | Invalid Bill UUID, missing/wrong confirmation, or malformed JSON |
| 401 | Not signed in |
| 403 | Origin mismatch or cross-site request |
| 404 | Bill not found or not owned by the caller |
| 413 / 415 | Body exceeds 8 KiB or unsupported Content-Type |
| 503 | Deletion/cleanup could not finish; safe to retry |

The graph cascade is one transaction. The owner is locked in the same order as
save/account-delete operations. A minimal internal `User.deletedBillIds` list
retains deleted IDs to prevent delayed workflow or manual-save retries from
recreating deleted bills. It contains no bill content and is removed with the
user account. Re-uploading the source generates a new job/Bill ID and is allowed.

After graph deletion, the service removes the owned temporary classification
job, input, and snapshot staging files. If filesystem cleanup fails after the
graph commit, the API returns 503 and a repeat request finishes cleanup without
restoring data. It does not remove exports already downloaded by a user.

### Row action

The combined **Bills** table and **Needs review** view have a sticky **Actions** column
with a Delete button per record. The button becomes available after the bill is
saved. It opens a popup identifying the file and explaining that all child data
will be removed. Cancel makes no request. Confirmation disables duplicate
submissions and calls this API.

The UI removes the document tab and every related combined-sheet row only after
success, reindexes the remaining records, and preserves unrelated edits. Failure
keeps the row and displays an error in the popup. The history offset is adjusted
when a loaded saved row is deleted so loading more does not skip a remaining bill.

Implementation: `bills/store.ts` (graph cascade), `bills/service.ts` (cache cleanup),
`bills/handlers.ts` (auth/validation), `components/delete-bill-dialog.tsx` (popup),
and `components/session-workbook.tsx` (row action).


### Financial mapping fields and review warnings

New workflow results include separate `order_id` and `shipping_method` columns in
`workbook.sheets` entries whose `id` is `receipts`. `document_number` remains the
invoice/receipt/bill number; `payment_method` is not a shipping method. Older
saved workbooks can omit these new columns. The original OCR snapshot is retained.
`workbook.warnings` includes source/semantic validation failures and arithmetic
review warnings. Checks preserve printed amounts, including discrepancies;
ambiguous currency/date/number formats are not guessed. No endpoint or request
body changed. These checks apply to new runs, not existing saved snapshots.

## Document library

`GET /api/documents?offset=0&q=invoice&folder=invoice` returns `files`, `nextOffset`,
and `folders`. Each file contains `billId`, `fileName`, `documentType`, `billNumber`,
`createdAt`, and `pageCount`. There are at most 50 files per page. `q` searches
filenames/invoice numbers (up to 200 characters); optional `folder` uses a supported
document type. Folder counts cover the owner's whole library. Responses require a
session and use `Cache-Control: no-store`. Invalid filters/pages return 400, unsigned
requests 401, database failure 503. No OCR JSON, model output, or vectors are loaded
by this listing. Detail pages use the same owner-scoped bill outputs as `/api/bills/{id}`.

## Document chat

Optional `billId` on `POST /api/chat` restricts every text/record query to one owned
bill. Omit it or send `null` for all the current user's bills. Invalid IDs return
400 and unknown/foreign IDs return the same 404. The chat interface no longer asks
users to choose documents. It resolves references in the question automatically.
Optional `contextBillId` carries the last resolved bill for conversational follow-ups
and is always ownership-checked; the response returns its updated value or `null`.
Chat remains a direct request/response workflow.

Simple English count, filename-list, and saved-total questions are routed to
parameterized record queries; these can work before embeddings are ready and
return `model: null`/empty sources. Total amounts are summed separately by known
currency, with exclusions disclosed. Complete-summary requests inspect all scoped
chunks (maximum 40/40,000 characters), and refuse incomplete or oversized scopes.

`GET /api/chat/documents?offset=0` returns `{ "documents": [{ "billId": "UUID",
"fileName": "invoice.pdf", "billNumber": "123" }], "nextOffset": null }` with up
to 100 entries, session ownership, and `Cache-Control: no-store`. It returns no
OCR or embeddings. Invalid offset: 400; unsigned: 401; unavailable database: 503.

`POST /api/chat` requires a signed-in session, same-origin JSON, and an input such
as `{ "question": "When is payment due?", "history": [] }`. History optionally
contains up to six `{ "role": "user" | "assistant", "content": "..." }` entries.
Questions allow 1–1,000 characters; history allows 1,000 per entry/4,000 total;
the body limit is 8,192 bytes. Ownership is always taken from the session.

Returns `{ "answer": "... [S1]", "sources": [...], "model": "...", "indexing":
{ "totalBills": 4, "readyBills": 4 } }`. Each source includes `id`, `billId`,
`chunkId`, `fileName`, `page`, `text`, and `score`; embeddings are never returned.
No-match/no-index responses have empty sources and `model: null`. Nothing in this
workflow writes chat messages or vectors. All responses use `Cache-Control:
no-store`. Errors: 401 unsigned, 403 cross-origin, 400 invalid input, 413 oversized,
415 wrong content type, 429 rate/concurrency/provider limit, 502 invalid/truncated
model output, 503 unavailable worker/database/provider. See
[chat setup and limits](../guides/chat.md).

## Local embeddings

`POST /api/embeddings/demo` (signed-in, same-origin, JSON): `{ "text": "Your text" }`
returns `model`, `dimensions`, `inferenceMode`, and the 768-number `vector`. Input
must be nonblank and at most 1,000 Unicode characters. The endpoint directly runs
local inference without database writes, file output, or Inngest events. Results
use `Cache-Control: no-store`. One demo request per server process can run at a
time; additional requests return 429. Model failures return a generic 503.

`POST /api/embeddings` (signed-in, same-origin, JSON): `{ "billId": "UUID" }`
queues a saved bill, or `{ "offset": 0 }` queues up to ten existing bills owned by
the current user. Returns 202 with queue results and, for backfills, `nextOffset`.
Requires `EMBEDDINGS_ENABLED=1` and Inngest. Missing bill: 404; unavailable original
OCR on a single bill: 409; invalid body: 400/413/415; unavailable service: 503.

`GET /api/embeddings?billId=UUID` (signed-in) returns `billId`, `status`, `profile`,
`chunkCount`, and `hasOcr`. It never returns vectors or OCR content. Both endpoints
use `Cache-Control: no-store`. See [setup and examples](../guides/embeddings.md).
