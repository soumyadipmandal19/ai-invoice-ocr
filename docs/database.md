# Database and saved history

[Back to README](../README.md)

Neo4j stores document ownership and related records as connected nodes:

```mermaid
graph LR
    S[Session] -->|BELONGS_TO| U[User]
    U -->|UPLOADED| B[Bill]
    B -->|HAS_ITEM| I[BillItem]
    B -->|HAS_OCR| O[OCRExtraction]
    B -->|HAS_LLM_RESULT| L[LLMResult]
```

| Node | Stored data |
| --- | --- |
| `User` | Account ID, name, email, salted password hash, and account metadata. |
| `Session` | Session token hash and expiry; linked to its user. |
| `Bill` | Document type, source filename, vendor/customer details, amounts, dates, order/shipping identifiers, warnings, and workbook/classification JSON. |
| `BillItem` | A line item's product details, quantities, prices, tax, discounts, and its bill association. |
| `OCRExtraction` | Original extraction JSON: page text, extraction methods, detected fields/tables, available bounding boxes, and warnings. |
| `LLMResult` | Model identity, validated classification and mapping results, merged organization, and generated workbook JSON. |

The graph stores selected fields as queryable properties and full nested outputs as JSON strings. It does not create a graph node for every text line or field. OCR and AI snapshots are kept separately so the original extraction can be compared with the model's interpretation.

The job ID becomes the stable bill ID. Saving uses `MERGE`, uniqueness constraints, and a single graph transaction to prevent duplicate bills or partial child records during retries. Ambiguous numeric values or dates remain available in the original workbook and can produce normalization warnings rather than guessed database values.

Ownership comes from the authenticated session. History and detail endpoints traverse the current user's `UPLOADED` relationships. Deleting a bill removes its items and OCR/AI snapshots; deleting an account also removes its sessions and owned bills. Deleted bill IDs are guarded against recreation by delayed workflow retries.

### Temporary jobs and saved history

- Job files and staged artifacts use `.data/classifications` by default and expire after 24 hours. `CLASSIFICATION_STORE_DIR` can override the directory.
- Successfully saved graph records remain after temporary jobs expire, until explicitly deleted.
- `GET /api/bills` restores the signed-in user's history with pagination.
- `GET /api/bills/[id]` returns the owner's original OCR, AI result, and workbook.
- `POST /api/bills` can retry saving an owned, staged job before it expires.
- Browser spreadsheet edits are not automatically persisted; a refresh restores the originally saved workbook.

No vector index or semantic-search workflow is currently implemented.
