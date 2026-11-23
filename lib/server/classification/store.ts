import "server-only";

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Classification, ClassificationJob } from "@/lib/classification/document";
import type { FinancialWorkbook } from "@/lib/financial/workbook";
import type { ExtractionResult } from "@/types/extraction/result";
import type { WorkflowArtifacts } from "@/types/workflow/artifacts";

const JOB_TTL = 24 * 60 * 60 * 1000;
const VALID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function directory() {
  return process.env.CLASSIFICATION_STORE_DIR || path.join(process.cwd(), ".data", "classifications");
}

function jobPath(id: string) {
  if (!VALID_ID.test(id)) throw new Error("Invalid classification job ID.");
  return path.join(directory(), `${id}.json`);
}

async function save(job: ClassificationJob) {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const target = jobPath(job.id);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readClassificationJob(id: string): Promise<ClassificationJob | null> {
  if (!VALID_ID.test(id)) return null;
  try {
    const job: ClassificationJob = JSON.parse(await readFile(jobPath(id), "utf8"));
    if (job.expiresAt <= Date.now()) {
      await rm(jobPath(id), { force: true });
      await rm(`${jobPath(id)}.input`, { force: true });
      await rm(`${jobPath(id)}.artifacts`, { force: true });
      return null;
    }
    return job;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function createClassificationJob(document?: ExtractionResult, ownerUserId?: string, upload?: { jobId: string; uploadKey: string }): Promise<ClassificationJob> {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  // Remove expired results and OCR input while creating new jobs.
  for (const name of (await readdir(directory())).filter((name) => name.endsWith(".json"))) {
    await readClassificationJob(name.slice(0, -5));
  }
  const job: ClassificationJob = { id: upload?.jobId || randomUUID(), status: "pending", expiresAt: Date.now() + JOB_TTL, ownerUserId, uploadKey: upload?.uploadKey };
  await save(job);
  if (document) {
    // OCR data stays on the host. Only the bounded classification excerpt enters Inngest.
    await writeFile(`${jobPath(job.id)}.input`, JSON.stringify(document), { mode: 0o600 });
  }
  return job;
}

export async function readClassificationInput(id: string): Promise<ExtractionResult> {
  return JSON.parse(await readFile(`${jobPath(id)}.input`, "utf8"));
}

export async function readClassificationArtifacts(id: string): Promise<WorkflowArtifacts | null> {
  try {
    return JSON.parse(await readFile(`${jobPath(id)}.artifacts`, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function stageClassificationWorkbook(id: string, result: Classification, workbook: FinancialWorkbook, artifacts?: WorkflowArtifacts) {
  const job = await readClassificationJob(id);
  if (!job) throw new Error("Classification job is missing or expired.");
  if (job.status === "complete") return;
  if (artifacts) {
    const target = `${jobPath(id)}.artifacts`;
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(artifacts), { mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  await save({ ...job, result, workbook, persistence: { status: "pending" }, error: undefined });
}

export async function completeClassificationJob(id: string, result: Classification, workbook?: FinancialWorkbook | null, billId?: string) {
  const job = await readClassificationJob(id);
  if (job) {
    await save({ ...job, status: "complete", result, workbook: workbook || undefined, error: undefined,
      persistence: billId ? { status: "saved", billId } : job.persistence });
    await rm(`${jobPath(id)}.input`, { force: true });
  }
}

export async function failClassificationJob(id: string, error: string) {
  const job = await readClassificationJob(id);
  if (job && job.status !== "complete") {
    await save({ ...job, status: "failed", error,
      persistence: job.persistence ? { status: "failed" } : undefined });
    await rm(`${jobPath(id)}.input`, { force: true });
  }
}

export async function deleteClassificationJobForOwner(id: string, ownerUserId: string) {
  const job = await readClassificationJob(id);
  if (!job || job.ownerUserId !== ownerUserId) return;
  // Keep the ownership metadata until content cleanup succeeds, so retries can
  // finish safely if a filesystem operation fails after the graph deletion.
  await Promise.all([rm(`${jobPath(id)}.input`, { force: true }), rm(`${jobPath(id)}.artifacts`, { force: true })]);
  await rm(jobPath(id), { force: true });
}
