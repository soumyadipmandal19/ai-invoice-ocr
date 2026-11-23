import "server-only";

import { inngest } from "@/lib/inngest/client";
import { buildClassificationSample, type ClassificationReference } from "@/lib/classification";
import { assertOpenRouterConfigured } from "@/lib/server/ai/openrouter";
import { completeClassificationJob, createClassificationJob, failClassificationJob } from "@/lib/server/classification/store";
import type { ExtractionResult } from "@/types/extraction/result";

export async function queueClassification(result: ExtractionResult, ownerUserId: string): Promise<ClassificationReference> {
  let jobId: string | undefined;
  try {
    const sample = buildClassificationSample(result.pages);
    if (sample) assertOpenRouterConfigured();
    if (!ownerUserId) throw new Error("An upload owner is required.");
    const job = await createClassificationJob(result, ownerUserId);
    jobId = job.id;
    if (!sample) {
      await completeClassificationJob(job.id, { documentType: "unknown", isFinancialDocument: false, sampledBytes: 0, model: null });
    } else {
      await inngest.send({
        id: job.id,
        name: "document/classification.requested",
        data: { jobId: job.id, sample },
      });
    }
    return { jobId: job.id };
  } catch {
    const error = "Document type detection is unavailable. Check OPENROUTER_API_KEY, OPENROUTER_MODEL, and the Inngest connection.";
    if (jobId) {
      try { await failClassificationJob(jobId, error); } catch { /* Extraction can still succeed if the job store is unavailable. */ }
    }
    return { error };
  }
}
