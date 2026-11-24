import "server-only";

import { createHash, randomBytes, randomUUID, scrypt as deriveKey, timingSafeEqual } from "node:crypto";
import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import { ensureDatabaseSchema, type SessionNode, type UserNode } from "@/lib/server/database/schema";
import type { AuthUser } from "@/types/auth/user";

const HASH_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function scrypt(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    deriveKey(password, salt, 64, HASH_OPTIONS, (error, key) => error ? reject(error) : resolve(key));
  });
}
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const configuration = () => ({ database: process.env.NEO4J_DATABASE || "neo4j" });

function publicUser(user: AuthUser): AuthUser {
  return { id: user.id, name: user.name, email: user.email };
}

export async function createUser(name: string, email: string, password: string): Promise<AuthUser | null> {
  await ensureDatabaseSchema();
  email = email.trim().toLowerCase();
  const salt = randomBytes(16).toString("hex");
  const passwordHash = (await scrypt(password, salt)).toString("hex");
  const user = { id: randomUUID(), name: name.trim(), email };
  const node: UserNode = { ...user, salt, passwordHash, createdAt: Date.now() };
  try {
    await getNeo4jDriver().executeQuery(
      "CREATE (u:User {id: $id, name: $name, email: $email, salt: $salt, passwordHash: $passwordHash, createdAt: $createdAt})",
      node, configuration(),
    );
  } catch (error) {
    if ((error as { code?: string }).code === "Neo.ClientError.Schema.ConstraintValidationFailed") {
      const existing = await getNeo4jDriver().executeQuery(
        "MATCH (u:User {email: $email}) RETURN u.id AS id", { email }, configuration(),
      );
      if (existing.records.length) return null;
    }
    throw error;
  }
  return user;
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  await ensureDatabaseSchema();
  const { records } = await getNeo4jDriver().executeQuery(
    "MATCH (u:User {email: $email}) RETURN u", { email: email.trim().toLowerCase() }, configuration(),
  );
  const user = records[0]?.get("u").properties as UserNode | undefined;
  // Perform the same expensive derivation for unknown accounts.
  const candidate = await scrypt(password, user?.salt || "unknown-account-salt");
  if (!user || !/^[a-f0-9]{128}$/.test(user.passwordHash) || !timingSafeEqual(candidate, Buffer.from(user.passwordHash, "hex"))) return null;
  return publicUser(user);
}

export async function createSession(user: AuthUser) {
  await ensureDatabaseSchema();
  const token = randomBytes(32).toString("hex");
  const node: SessionNode = { tokenHash: digest(token), expiresAt: Date.now() + SESSION_SECONDS * 1000 };
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (u:User {id: $id})
     CREATE (s:Session {tokenHash: $tokenHash, expiresAt: $expiresAt})-[:BELONGS_TO]->(u)
     RETURN s.tokenHash AS tokenHash`,
    { id: user.id, ...node }, configuration(),
  );
  if (!records.length) throw new Error("Cannot create a session for a missing user.");
  return token;
}

export async function readSession(token: string | undefined): Promise<AuthUser | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  await ensureDatabaseSchema();
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (s:Session {tokenHash: $tokenHash})-[:BELONGS_TO]->(u:User)
     WHERE s.expiresAt > $now
     RETURN u.id AS id, u.name AS name, u.email AS email`,
    { tokenHash: digest(token), now: Date.now() }, configuration(),
  );
  if (!records.length) return null;
  return { id: records[0].get("id"), name: records[0].get("name"), email: records[0].get("email") };
}

export async function deleteSession(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  await ensureDatabaseSchema();
  await getNeo4jDriver().executeQuery(
    "MATCH (s:Session {tokenHash: $tokenHash}) DETACH DELETE s", { tokenHash: digest(token) }, configuration(),
  );
}

export async function deleteAccount(token: string | undefined): Promise<boolean> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  await ensureDatabaseSchema();
  // Authorize and remove the account and all its sessions in one transaction.
  // A caller cannot choose another account through a request body or user ID.
  const { records } = await getNeo4jDriver().executeQuery(
    `MATCH (current:Session {tokenHash: $tokenHash})-[:BELONGS_TO]->(u:User)
     WHERE current.expiresAt > $now
     SET u.id = u.id
     WITH u
     OPTIONAL MATCH (u)-[:UPLOADED]->(b:Bill)
     OPTIONAL MATCH (b)-[:HAS_ITEM]->(item:BillItem)
     OPTIONAL MATCH (b)-[:HAS_OCR]->(ocr:OCRExtraction)
     OPTIONAL MATCH (b)-[:HAS_LLM_RESULT]->(llm:LLMResult)
     OPTIONAL MATCH (b)-[:HAS_EMBEDDINGS]->(embeddings:DocumentEmbeddings)
     OPTIONAL MATCH (b)-[:HAS_EMBEDDINGS|HAS_CHUNK*1..2]->(chunk:DocumentChunk)
     WITH u, collect(DISTINCT b) AS bills, collect(DISTINCT item) AS items,
       collect(DISTINCT ocr) AS ocrSnapshots, collect(DISTINCT llm) AS llmSnapshots,
       collect(DISTINCT chunk) AS chunks, collect(DISTINCT embeddings) AS embeddingGroups
     OPTIONAL MATCH (s:Session)-[:BELONGS_TO]->(u)
     WITH u, bills, items, ocrSnapshots, llmSnapshots, chunks, embeddingGroups, collect(DISTINCT s) AS sessions
     OPTIONAL MATCH (u)-[:HAS_UPLOAD]->(upload:DocumentUpload)
     WITH u, bills, items, ocrSnapshots, llmSnapshots, chunks, embeddingGroups, sessions, collect(DISTINCT upload) AS uploads
     FOREACH (item IN items | DETACH DELETE item)
     FOREACH (bill IN bills | DETACH DELETE bill)
     FOREACH (snapshot IN ocrSnapshots | DETACH DELETE snapshot)
     FOREACH (snapshot IN llmSnapshots | DETACH DELETE snapshot)
     FOREACH (chunk IN chunks | DETACH DELETE chunk)
     FOREACH (group IN embeddingGroups | DETACH DELETE group)
     FOREACH (session IN sessions | DETACH DELETE session)
     FOREACH (upload IN uploads | DETACH DELETE upload)
     DETACH DELETE u
     RETURN true AS deleted`,
    { tokenHash: digest(token), now: Date.now() }, configuration(),
  );
  return records[0]?.get("deleted") === true;
}
