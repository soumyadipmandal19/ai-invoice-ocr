# Shared contracts

Group shared types by the feature that owns them. These modules are used by both
the frontend and backend; keep server secrets and database clients out of them.

```text
types/
├── auth/
│   └── user.ts             Public authenticated-user details
├── bills/
│   ├── models.ts           Canonical bill, item, and dataset models
│   └── responses.ts        Saved bill and paginated history responses
├── extraction/
│   └── result.ts           OCR result, upload limits, and result validation
├── workflow/
│   └── artifacts.ts        Original OCR and validated model output snapshots
└── workspace/
    └── record.ts           Dashboard upload record and processing state
```

Import directly from the owning file, for example:

```ts
import type { BillRecord } from "@/types/bills/models";
import type { SavedBillPage } from "@/types/bills/responses";
import type { WorkspaceRecord } from "@/types/workspace/record";
```

Use `import type` when importing only a TypeScript type. The extraction contracts
also export browser-safe runtime guards and limits so API results are validated
consistently. Database node extensions and Neo4j constraints remain in
`lib/server/database/schema.ts`. Financial organization and classification types
remain with their owning modules in `lib/`.

Add new contracts under their feature folder, reuse existing types, and avoid a
root barrel file that mixes unrelated features and runtime dependencies.
