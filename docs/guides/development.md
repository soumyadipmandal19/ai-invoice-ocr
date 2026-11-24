# Development guide

[Back to README](../../README.md)

## Project structure

```text
app/                    Pages and API routes
components/             Upload, preview, extraction review, and workbook UI
lib/inngest/            Event client and background workflow functions
lib/server/ai/          OpenRouter calls and model response validation
lib/server/extraction/  Python worker invocation
lib/server/classification/  Temporary job storage and event submission
lib/server/database/    Neo4j driver, node types, and uniqueness constraints
lib/server/bills/       Normalization, graph persistence, and bill APIs
lib/server/auth/        Accounts, password hashing, and sessions
lib/financial-*.ts      Mapping preparation, validation, and workbook generation
python/ocr/             PDF/image reading, Tesseract recognition, field/table detection
python/tests/           Python extraction regression tests
tests/                  JavaScript workflow and persistence tests
scripts/build/          PDF worker setup for install, development, and builds
scripts/database/       Neo4j connectivity and query checks
scripts/datasets/       Example dataset and workbook generation
data/bills/             Example data and workbook schema
```

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run test:python
npm run build
```

Python tests generate digital, scanned, mixed, malformed, and protected PDFs and test image, field, and table extraction. OCR checks skip when English language data is unavailable. Set `OCR_SAMPLE_PDF` to a local sample path to enable the optional supplied-invoice regression.

If Turbopack's CSS worker cannot bind a port in a restricted environment, use `npm run build -- --webpack` for the production build check.

On Windows PowerShell, replace `npm run test:python` with:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s python/tests -v
```

The root `tests/` directory is ignored by Git. The `test:classification`,
`test:auth`, `test:workbook`, `test:bills`, and `test:history` npm commands
require those local JavaScript test files and are unavailable in a fresh clone.
They mock external dependencies and do not establish live-model accuracy.

## Database query validation

With `.env.local` configured, validate graph queries without changing data:

```bash
node --env-file=.env.local scripts/database/check-bill-queries.mjs
```

## Workbook templates

See the [dataset guide](../../data/bills/README.md) for schema details and rebuilding
local workbook templates.
