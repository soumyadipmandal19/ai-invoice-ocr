import "server-only";

import { getNeo4jDriver } from "@/lib/server/database/neo4j";
import { recordQuestionIntent } from "@/lib/server/chat/records";
import type { ChatDocument, ChatHistoryMessage } from "@/types/chat";

const ignoredNames = new Set(["this", "that", "the", "my", "a", "an", "all", "each", "every", "same", "uploaded", "saved", "amount", "total", "payment", "number", "details", "explanation"]);

export async function resolveChatContext(ownerUserId: string, question: string, history: ChatHistoryMessage[], previousBillId: string | null) {
  const lower = question.toLowerCase();
  const intent = recordQuestionIntent(question);
  if (/\b(?:compare|both|between|versus)\b/i.test(question)
    || /\b\w+\s+and\s+\w+\s+(?:invoices|bills|files|documents)\b/i.test(question)) return { billId: null, clarification: null };
  const local = /\b(?:this|that|same|its)\b/i.test(question);
  if (/\b(?:all|every)\s+(?:of\s+)?(?:my\s+|the\s+)?(?:files?|documents?|bills?|invoices?)\b/i.test(question)
    || (intent && !local)) return { billId: null, clarification: null };
  const hasFileName = /\.(?:pdf|png|jpe?g|webp|bmp)\b/i.test(question);
  const tokens = [...new Set(lower.match(/[a-z0-9][a-z0-9._-]*/g) || [])]
    .filter((token) => /\d/.test(token) && token.length >= 3)
    .filter((token) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return hasFileName || new RegExp(`\\b(?:invoice|bill|file|document)(?:\\s+(?:number|no\\.?))?\\s*[:#]?\\s*${escaped}\\b`).test(lower)
        || new RegExp(`^\\s*${escaped}(?:\\s+(?:bills?|invoices?|files?|documents?)\\b|\\s*$)`).test(lower);
    });
  const names: string[] = [];
  for (const match of lower.matchAll(/\b(?:invoice|bill|file|document)s?\s+(?:(?:for|from|of)\s+)?([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/g)) {
    const words = match[1].split(/\s+/).filter((word) => !ignoredNames.has(word));
    if (words.length) names.push(words.join(" "));
  }
  for (const match of lower.matchAll(/\b([a-z][a-z'-]*)(?:'s|’s)?\s+(?:bill|invoice|file|document)\b/g)) {
    const name = match[1].replace(/'s$/, "");
    if (!ignoredNames.has(name)) names.push(name);
  }
  if (tokens.length || names.length || hasFileName) {
    const { records } = await getNeo4jDriver().executeQuery(
      `MATCH (:User {id: $ownerUserId})-[:UPLOADED]->(b:Bill)
       WHERE replace(toLower(coalesce(b.billNumber, '')), '#', '') IN $tokens
         OR (b.sourceFile IS NOT NULL AND $question CONTAINS toLower(b.sourceFile))
         OR any(token IN $tokens WHERE
           (' ' + replace(replace(replace(toLower(coalesce(b.sourceFile, '')), '_', ' '), '.', ' '), '-', ' ') + ' ') CONTAINS (' ' + token + ' '))
         OR any(name IN $names WHERE
           (' ' + toLower(coalesce(b.customerName, '')) + ' ') CONTAINS (' ' + name + ' ')
           OR (' ' + toLower(coalesce(b.vendorName, '')) + ' ') CONTAINS (' ' + name + ' ')
           OR (' ' + replace(replace(toLower(coalesce(b.sourceFile, '')), '_', ' '), '.', ' ') + ' ') CONTAINS (' ' + name + ' '))
       RETURN DISTINCT b.billId AS billId, b.sourceFile AS fileName, b.billNumber AS billNumber,
         true AS referenceMatch ORDER BY fileName, billId LIMIT 11`,
      { ownerUserId, question: lower, tokens, names },
      { database: process.env.NEO4J_DATABASE || "neo4j", routing: "READ", transactionConfig: { timeout: 10_000 } });
    const matches = records.map((row): ChatDocument => ({ billId: row.get("billId"), fileName: row.get("fileName") || "Saved bill", billNumber: row.get("billNumber") }));
    if (matches.length === 1) return { billId: matches[0].billId, clarification: null };
    if (matches.length > 1 && !/\b(?:compare|both|between)\b/i.test(question)) {
      return { billId: null, clarification: `I found more than one matching document. Which one do you mean?\n${matches.slice(0, 10).map((doc) => `${doc.fileName}${doc.billNumber ? ` (invoice ${doc.billNumber})` : ""}`).join("\n")}\nReply with its invoice number or full filename.` };
    }
    if (!matches.length && (hasFileName || (tokens.length && /\b(?:invoice|bill|file|document)\b/i.test(question)) || /^\s*\d{3,}\s*$/.test(question))) {
      return { billId: null, clarification: "I couldn't find that document among your saved bills. Please check its invoice number or filename." };
    }
    if (matches.length > 1) return { billId: null, clarification: null };
  }
  const followUp = local || /^(?:and\b|also\b|what about\b|how about\b)/i.test(question)
    || (history.length > 0 && question.trim().split(/\s+/).length <= 6 && !/^(?:find|search|list|which|how many)\b/i.test(question));
  if (followUp && previousBillId) return { billId: previousBillId, clarification: null };
  if (local) return { billId: null, clarification: "Which invoice do you mean? Tell me its invoice number, filename, or the name on the bill." };
  return { billId: null, clarification: null };
}
