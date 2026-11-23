import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import { ensureDatabaseSchema } from "@/lib/server/database/schema";
import { readClassificationJob, readClassificationInput, readClassificationArtifacts } from "@/lib/server/classification/store";
import { readBillOutputs } from "@/lib/server/bills/store";
import type { ExtractionResult } from "@/types/extraction/result";
import type { DuplicateUpload } from "@/types/extraction/upload";

const EXTRACTION_LEASE_MS = 5 * 60 * 1000;
const configuration = () => ({ database: process.env.NEO4J_DATABASE || "neo4j" });
export type UploadClaim = { uploadKey: string; jobId: string };

export async function releaseUpload(claim: UploadClaim, ownerUserId: string) {
  // Compare the job ID so an old request cannot remove a newer attempt's claim.
  await getNeo4jDriver().executeQuery(
    `MATCH (u:User {id: $ownerUserId}) SET u.id = u.id
     WITH u MATCH (u)-[:HAS_UPLOAD]->(upload:DocumentUpload {uploadKey: $uploadKey, jobId: $jobId})
     WHERE NOT EXISTS { MATCH (u)-[:UPLOADED]->(:Bill {billId: $jobId}) }
     DETACH DELETE upload`,
    { ...claim, ownerUserId }, configuration(),
  );
}

/** Serialize claims in Neo4j, including requests handled by different app instances. */
export async function claimUpload(content: Buffer, ownerUserId: string): Promise<UploadClaim | DuplicateUpload> {
  const fileHash = createHash("sha256").update(content).digest("hex");
  const uploadKey = createHash("sha256").update(JSON.stringify([ownerUserId, fileHash])).digest("hex");
  await ensureDatabaseSchema();
  for (let attempt = 0; attempt < 3; attempt++) {
    const proposedId = randomUUID();
    const { records } = await getNeo4jDriver().executeQuery(
      `MATCH (u:User {id: $ownerUserId}) SET u.id = u.id
       WITH u MERGE (upload:DocumentUpload {uploadKey: $uploadKey})
       ON CREATE SET upload.jobId = $jobId, upload.createdAt = $now
       MERGE (u)-[:HAS_UPLOAD]->(upload)
       RETURN upload.jobId AS jobId, upload.createdAt AS createdAt`,
      { ownerUserId, uploadKey, jobId: proposedId, now: Date.now() }, configuration(),
    );
    if (!records.length) throw new Error("Upload owner is unavailable.");
    const jobId: string = records[0].get("jobId");
    if (jobId === proposedId) return { uploadKey, jobId };
    // Saved results outlive local jobs; look in Neo4j before checking job expiry.
    const saved = await readBillOutputs(jobId, ownerUserId);
    if (saved) {
      const ocr = saved.ocr as ExtractionResult | null;
      return { duplicate: true, jobId, message: "This file is already saved. Opened the existing document.", bill: {
        billId: jobId, sourceFile: saved.sourceFile || ocr?.sourceFileName || "Saved document", createdAt: saved.createdAt || "",
        ocr, workbook: saved.workbook, classification: saved.llm?.classification || null,
      } };
    }
    const job = await readClassificationJob(jobId);
    if (job && job.ownerUserId === ownerUserId && (job.status !== "failed" || job.persistence)) {
      let document: ExtractionResult | undefined;
      if (job.status === "pending") {
        try { document = await readClassificationInput(jobId); } catch { /* A completing job may have just removed its input. */ }
      }
      if (!document && job.persistence) document = (await readClassificationArtifacts(jobId))?.ocr;
      return { duplicate: true, jobId, document: document ? { ...document, classification: { jobId } } : undefined,
        message: job.status === "failed" ? "This file has an organized result awaiting saving. Retry saving the existing result."
          : job.status === "complete" ? "This file was already processed in this session."
          : "This file is already processing. Reusing the existing job; no second upload was created." };
    }
    const createdAt = Number(records[0].get("createdAt"));
    if (!job && Date.now() - createdAt < EXTRACTION_LEASE_MS) {
      return { duplicate: true, jobId, message: "This file is already being extracted. Please wait, then try again to open its result." };
    }
    // Failed jobs without staged financial data, expired jobs, and abandoned
    // extraction claims can be retried. The save query rejects superseded jobs.
    await releaseUpload({ uploadKey, jobId }, ownerUserId);
  }
  throw new Error("Unable to reserve the upload. Please try again.");
}
