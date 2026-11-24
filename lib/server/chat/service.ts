import "server-only";

import { embedTexts } from "@/lib/server/embeddings/local";
import { generateChatAnswer } from "@/lib/server/chat/answer";
import { readChatIndexing, readSummarySources, retrieveChatSources } from "@/lib/server/chat/retrieval";
import { recordQuestionIntent, listChatDocuments, readBillTotals } from "@/lib/server/chat/records";
import { ChatModelError } from "@/lib/server/chat/answer";
import { resolveChatContext } from "@/lib/server/chat/context";
import type { ChatHistoryMessage, ChatResponse } from "@/types/chat";

export async function answerDocumentQuestion(ownerUserId: string, question: string, history: ChatHistoryMessage[], signal?: AbortSignal, billId: string | null = null, previousBillId: string | null = null): Promise<ChatResponse> {
  if (!billId) {
    const resolved = await resolveChatContext(ownerUserId, question, history, previousBillId);
    if (resolved.clarification) return { answer: resolved.clarification, sources: [], model: null,
      contextBillId: null, indexing: await readChatIndexing(ownerUserId) };
    billId = resolved.billId;
  }
  const indexing = await readChatIndexing(ownerUserId, billId);
  if (billId && !indexing.totalBills) throw new ChatModelError("That document is unavailable. Tell me another invoice number or filename.", 404);
  const intent = recordQuestionIntent(question);
  const fromRecords = (answer: string): ChatResponse => ({ answer, sources: [], model: null, indexing, contextBillId: billId });
  if (intent === "count") return fromRecords(billId ? "There is 1 saved bill in the selected scope."
    : `You have ${indexing.totalBills} saved bill${indexing.totalBills === 1 ? "" : "s"}.`);
  if (intent === "files") {
    const { documents, nextOffset } = await listChatDocuments(ownerUserId, billId);
    return fromRecords(documents.length ? `${billId ? "Document" : "Your saved documents"}:\n${documents.map((doc, index) => `${index + 1}. ${doc.fileName}`).join("\n")}${nextOffset !== null ? `\nShowing the first 100 of ${indexing.totalBills} saved bills. Mention an invoice number or filename to narrow your question.` : ""}` : "You have no saved bills yet.");
  }
  if (intent === "totals") {
    if (indexing.totalBills > 10_000) return fromRecords("This calculation exceeds the current 10,000-bill limit. Mention an invoice number or filename to narrow the question.");
    const { totals, excluded } = await readBillTotals(ownerUserId, billId);
    return fromRecords(`${totals.length ? `Sum of saved bill totals, kept separate by currency:\n${totals.join("\n")}` : "No bill totals with a known currency are available in this scope."}${excluded ? `\nExcluded ${excluded} bill${excluded === 1 ? "" : "s"} with a missing amount or unknown/ambiguous currency.` : ""}\nThese are saved document totals, not confirmation of payment.`);
  }
  if (!indexing.readyBills) {
    return { answer: indexing.totalBills
      ? "Your saved bills do not have searchable text ready yet. Finish preparing their embeddings, then try again."
      : "Upload and process a bill first, then ask a question about it.", sources: [], model: null, indexing };
  }
  if (intent === "summary") {
    if (indexing.readyBills !== indexing.totalBills) return fromRecords(`Only ${indexing.readyBills} of ${indexing.totalBills} documents have searchable text ready. Finish preparing the remaining documents before requesting a complete summary.`);
    const sources = await readSummarySources(ownerUserId, billId);
    if (!sources) return fromRecords("This collection is too large for a complete summary in one response. Mention an invoice number or filename to narrow your question.");
    if (!sources.length) return fromRecords("No searchable text is available in this scope.");
    const answer = await generateChatAnswer(`${question}\nSummarize each supplied document separately by filename. All indexed text sections in the selected scope are supplied.`, history, sources, signal);
    return { ...answer, indexing, contextBillId: billId };
  }
  // Keep follow-ups anchored to the prior question without another model call.
  const previous = history.filter((message) => message.role === "user").slice(-1)[0]?.content;
  const searchText = previous ? `${Array.from(previous).slice(0, 500).join("")}\n${question}` : question;
  const [vector] = await embedTexts([searchText], "search_query", signal);
  const sources = await retrieveChatSources(ownerUserId, vector, billId);
  if (!sources.length) return { answer: "I couldn't find matching bill text for that question. Try mentioning a product, vendor, or invoice detail.",
    sources: [], model: null, indexing };
  const answer = await generateChatAnswer(question, history, sources, signal);
  const citedBills = new Set(answer.sources.map((source) => source.billId));
  return { ...answer, indexing, contextBillId: billId || (citedBills.size === 1 ? [...citedBills][0] : null) };
}
