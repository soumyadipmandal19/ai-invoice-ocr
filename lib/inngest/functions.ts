import { inngest } from "@/lib/inngest/client";
import { NonRetriableError } from "inngest";
import { MAX_CLASSIFICATION_BYTES } from "@/lib/classification";
import { classifyDocument, organizeFinancialChunk } from "@/lib/server/ai/openrouter";
import { completeClassificationJob, failClassificationJob, readClassificationInput, readClassificationJob, stageClassificationWorkbook } from "@/lib/server/classification/store";
import { saveOrganizedBill, BillSaveError } from "@/lib/server/bills/service";
import { BillOwnerMissingError } from "@/lib/server/bills/store";
import { organizeFinancialDocument } from "@/lib/financial-workbook";
import { mergeOrganizationChunks, prepareOrganizationInput, type OrganizationChunkResult } from "@/lib/financial-organization";

// Invoke from the Dev Server to verify registration and step execution.
export const configurationCheck = inngest.createFunction(
  {
    id: "configuration-check",
    triggers: { event: "app/inngest.test" },
  },
  async ({ step }) => {
    return await step.run("confirm-configuration", () => ({
      app: "ocr-project",
      message: "Inngest is configured and running.",
    }));
  },
);

export const classifyUploadedDocument = inngest.createFunction(
  {
    id: "classify-document",
    triggers: { event: "document/classification.requested" },
    retries: 2,
    concurrency: { limit: 2 },
    onFailure: async ({ event }) => {
      const jobId = event.data.event.data.jobId;
      if (typeof jobId === "string") {
        const job = await readClassificationJob(jobId);
        await failClassificationJob(jobId, job?.persistence
          ? "Financial data was organized but could not be saved to the database. Retry saving this result using POST /api/bills."
          : "Document processing failed. Check the Inngest run and OpenRouter configuration. If the document exceeds the organization budget, split it into smaller receipts.");
      }
    },
  },
  async ({ event, step }) => {
    const { jobId, sample } = event.data;
    if (typeof jobId !== "string" || typeof sample !== "string" || Buffer.byteLength(sample, "utf8") > MAX_CLASSIFICATION_BYTES) {
      throw new NonRetriableError("Invalid document classification event.");
    }
    const active = await step.run("check-job", async () => {
      const job = await readClassificationJob(jobId);
      if (!job) throw new NonRetriableError("Classification job is missing or expired.");
      if (!job.ownerUserId) throw new NonRetriableError("This older job has no upload owner. Upload the document again.");
      return job.status === "pending";
    });
    if (!active) return { jobId };
    const result = await step.run("classify-document-excerpt", () => classifyDocument(sample));
    if (result.isFinancialDocument) {
      const plan = await step.run("plan-financial-mapping", async () => {
        const document = await readClassificationInput(jobId);
        try {
          return { chunkCount: prepareOrganizationInput(document).length, layoutVersion: 3 };
        } catch (error) {
          throw new NonRetriableError(error instanceof Error ? error.message : "Unable to prepare financial mapping.");
        }
      });
      const mapped: OrganizationChunkResult[] = [];
      // Bound parallel requests to avoid flooding the provider on larger documents.
      for (let start = 0; start < plan.chunkCount; start += 2) {
        const batch = Array.from({ length: Math.min(2, plan.chunkCount - start) }, (_, offset) => start + offset);
        mapped.push(...await Promise.all(batch.map((index) => step.run(`llm-map-financial-data-${index + 1}`, async () => {
          const document = await readClassificationInput(jobId);
          // Cached plans from running jobs retain their original chunk boundaries.
          const chunks = prepareOrganizationInput(document, plan.layoutVersion === 3 ? undefined : plan.layoutVersion === 2 ? { layoutVersion: 2 } : { legacyRecordLimit: 20 });
          return organizeFinancialChunk(chunks[index], result.documentType);
        }))));
      }
      await step.run("save-financial-csv", async () => {
        // A retried save must not need an input already removed after success.
        const saved = await readClassificationJob(jobId);
        if (saved?.workbook) return { sheetCount: saved.workbook.sheets.length };
        const document = await readClassificationInput(jobId);
        const organization = mergeOrganizationChunks(mapped, result.documentType === "bank_statement");
        const workbook = organizeFinancialDocument(document, result, { documentId: jobId, organization });
        if (!workbook) throw new NonRetriableError("Financial workbook was not produced.");
        await stageClassificationWorkbook(jobId, result, workbook, { ocr: document, organization, mappingResults: mapped });
        // Full OCR source stays local; only compact inputs and mapped values reach the model.
        return { sheetCount: workbook?.sheets.length || 0 };
      });
      await step.run("save-bill-to-neo4j", async () => {
        const job = await readClassificationJob(jobId);
        if (!job?.ownerUserId) throw new NonRetriableError("Upload owner is missing. Upload the document again.");
        try {
          return await saveOrganizedBill(jobId, job.ownerUserId);
        } catch (error) {
          if (error instanceof BillOwnerMissingError || error instanceof BillSaveError) {
            throw new NonRetriableError(error.message);
          }
          throw error;
        }
      });
    } else {
      await step.run("skip-nonfinancial-document", () => completeClassificationJob(jobId, result));
    }
    return { jobId, ...result };
  },
);

export const functions = [configurationCheck, classifyUploadedDocument];
