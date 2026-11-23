# Paper to Text

Extract text from PDFs and images, classify financial documents with AI, and review structured invoice data. Signed-in users can return to saved results stored in Neo4j.

![Document upload and invoice review dashboard](docs/images/document-workbook.png)

## Features

- Upload and preview PDF, PNG, JPG/JPEG, WebP, and BMP files.
- Read digital PDF text and recognize scanned content with local English OCR.
- Use AI to classify documents and organize receipt details and line items.
- Review extracted text, fields, and tables; copy text or download TXT, JSON, and financial CSV output.
- Sign in to restore saved financial documents or delete them from your history.
- Repeated uploads of the same file reuse your existing job or saved document.

**Stack:** Next.js 16 · React 19 · TypeScript · Python · PyMuPDF · Tesseract · OpenRouter · Inngest · Neo4j.

## Quick start

### 1. Prerequisites

Install Git, Node.js 24+ with npm, and Python 3 with wheels available for the [pinned packages](python/requirements.txt). You also need a running Neo4j database and an OpenRouter API key with access to a text-generation model.

```bash
git clone https://github.com/soumyadipmandal19/ai-invoice-ocr.git
cd ai-invoice-ocr
```

### 2. Install for your operating system

Run the commands for your OS from the project root. Copy `.env.example` only on initial setup; keep an existing `.env.local`.

#### macOS — Terminal

Install [Homebrew](https://brew.sh/) first if needed.

```bash
brew install tesseract
npm install
npm run setup:python
cp .env.example .env.local
brew --prefix
```

In `.env.local`, set `PYTHON_EXECUTABLE=.venv/bin/python`. Set `TESSDATA_PREFIX` to the Homebrew prefix printed above plus `/share/tessdata` (usually `/opt/homebrew/share/tessdata` or `/usr/local/share/tessdata`).

#### Windows — PowerShell

Install Tesseract with English language data using the Windows installer linked in the [Tesseract installation guide](https://tesseract-ocr.github.io/tessdoc/Installation.html#windows).

```powershell
npm install
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r python/requirements.txt
Copy-Item .env.example .env.local
```

Set these values in `.env.local`, adjusting the Tesseract path to your installation:

```dotenv
PYTHON_EXECUTABLE=.venv/Scripts/python.exe
TESSDATA_PREFIX="C:/Program Files/Tesseract-OCR/tessdata"
```

Use the explicit commands above: `npm run setup:python` assumes a macOS/Linux virtual environment layout.

#### Linux — Ubuntu/Debian

```bash
sudo apt update
sudo apt install python3 python3-venv tesseract-ocr tesseract-ocr-eng
npm install
npm run setup:python
cp .env.example .env.local
dpkg -L tesseract-ocr-eng
```

Locate `eng.traineddata` in the package listing. In `.env.local`, set `PYTHON_EXECUTABLE=.venv/bin/python` and set `TESSDATA_PREFIX` to that file's containing directory. For other distributions, install equivalent Python, virtual environment, and [Tesseract English data packages](https://tesseract-ocr.github.io/tessdoc/Installation.html).

### 3. Configure services

Edit `.env.local` after setting the Python and OCR paths above:

| Setting | What to enter |
| --- | --- |
| `OPENROUTER_API_KEY` | Your OpenRouter API key. |
| `OPENROUTER_MODEL` | An available text-generation model ID in `provider/model` format. |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | Your Neo4j connection details. |
| `NEO4J_DATABASE` | Your database name, commonly `neo4j`. |
| `INNGEST_DEV` | Keep `1` for local development. |

Replace the app name placeholder in `OPENROUTER_APP_NAME` and keep `OPENROUTER_APP_URL=http://localhost:3000` locally. The database user needs permission to create uniqueness constraints. `TESSDATA_PREFIX` must contain `eng.traineddata`.

Keep credentials in `.env.local`, which Git ignores. See [.env.example](.env.example) for all settings. Restart the app after configuration changes.

### 4. Start the app

Check the database connection first:

```bash
npm run check:neo4j
```

- **Connected:** prints `Neo4j Aura connected: credentials and database query verified.` Continue below.
- **Failed:** prints `Neo4j check failed.` Check that Neo4j is running, the `NEO4J_*` settings in `.env.local` are correct, and the database is reachable. Rerun the check until it succeeds.

`npm run dev` can start even when Neo4j is unavailable, but database-dependent actions such as sign-in and saving documents will fail. Starting the app does not confirm a database connection.

After the check succeeds, start Next.js:

```bash
npm run dev
```

In a second terminal, from the project root:

```bash
npm run dev:inngest
```

Open [the app](http://localhost:3000). Inspect background runs in [Inngest](http://localhost:8288). The first Inngest launch downloads its CLI. If Next.js uses a different port, update the target URL in the `dev:inngest` command in `package.json`.

## Usage

1. Sign up or sign in, then upload a PDF or image.
2. Review the extracted text while AI classification and financial mapping finish.
3. Use the document tabs to open a file, or select All bills for the combined workbook. Bills combines upload status and bill details; Bill Items links purchases using Bill ID; Needs review shows outstanding checks. Search and filter by vendor, currency, bill date, or review status. Essential columns appear first; use Columns for additional fields. Open bill & source for original OCR and standard-form comparisons. Export Excel downloads Bills and Bill Items with all columns, matching IDs, current filters, and edits; CSV exports the visible table. Printed values remain text in Excel to preserve identifiers and number formats. Review notes use short checklists; complete validation messages remain in the selected bill’s review panel. Item notes contain item-specific checks instead of repeating all bill warnings. The default AI disclaimer is omitted from exported Notes; user notes are preserved.
4. Return to saved financial documents through your history. Browser edits are not automatically saved; refreshing restores the original saved result.

## Limits and data handling

- **Uploads:** up to 10 MB, 1–20 PDF pages, or 20 million pixels per image. Extraction times out after 120 seconds.
- **Accuracy:** English OCR; complex layouts and handwriting may need correction. Review AI results before using them.
- **AI processing:** extracted text is sent to OpenRouter. Original PDFs and images are not sent. Mapping has a separate text budget, so larger documents may need splitting.
- **Storage:** uploaded files are removed after extraction. Temporary jobs expire after 24 hours; saved OCR text and AI results remain in Neo4j until deleted. Unsupported financial classifications keep text available only in the current browser session.

## Documentation

- [Architecture and AI workflow](docs/architecture.md)
- [Database and saved history](docs/database.md)
- [Development, checks, and project structure](docs/development.md)
- [Deployment](docs/deployment.md)
- [Backend layout](lib/server/README.md) · [API reference](docs/api/API.md)
- [Dataset and schema](data/bills/README.md) · [Environment template](.env.example)
