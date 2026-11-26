import "server-only";

import { embedTexts } from "@/lib/server/embeddings/local";
import { generateChatAnswer, ChatModelError } from "@/lib/server/chat/answer";
import { readChatIndexing, readSummarySources, retrieveChatSources } from "@/lib/server/chat/retrieval";
import { readBillTotals } from "@/lib/server/chat/records";
import { resolveChatContext } from "@/lib/server/chat/context";
import { hasBillFilters, planDocumentQuestion } from "@/lib/server/chat/plan";
import { describeBillFilters, formatStructuredAnswer, selectStructuredBills } from "@/lib/server/chat/query";
import type { ChatHistoryMessage, ChatResponse } from "@/types/chat";

/** Execute validated plans against metadata before considering document-text retrieval. */
export async function answerDocumentQuestion(ownerUserId: string, question: string, history: ChatHistoryMessage[], signal?: AbortSignal, billId: string | null = null, previousBillId: string | null = null): Promise<ChatResponse> {
  const plan = await planDocumentQuestion(question, history, signal, ownerUserId);
  const filtered = hasBillFilters(plan.filters);
  // An explicit API scope is never widened by a model. Conversation context is
  // reused only when the planner identifies a follow-up about the current bill.
  billId ??= plan.scope === "current" ? previousBillId : null;
  if (!billId && (plan.operation === "search" || plan.operation === "summary") && !filtered) {
    const resolved = await resolveChatContext(ownerUserId, question, history, plan.scope === "current" ? previousBillId : null);
    if (resolved.clarification) return { answer: resolved.clarification, sources: [], model: null,
      contextBillId: null, indexing: await readChatIndexing(ownerUserId) };
    billId = resolved.billId;
  }
  let indexing = await readChatIndexing(ownerUserId, billId);
  if (billId && !indexing.totalBills) throw new ChatModelError("That document is unavailable. Tell me another invoice number or filename.", 404);
  const fromRecords = (answer: string): ChatResponse => ({ answer, sources: [], model: null, indexing, contextBillId: billId });
  if (plan.operation === "clarify") return fromRecords(plan.clarification!);
  if (plan.operation !== "search" && plan.scope === "current" && !billId && !filtered)
    return fromRecords("Which invoice do you mean? Tell me its invoice number or filename.");
  if (plan.operation === "count" && !filtered && !plan.groupBy) return fromRecords(billId ? "There is 1 saved bill in the selected scope."
    : `You have ${indexing.totalBills} saved bill${indexing.totalBills === 1 ? "" : "s"}.`);
  if (plan.operation === "total" && !filtered && !plan.groupBy) {
    if (indexing.totalBills > 10_000) return fromRecords("This calculation exceeds the current 10,000-bill limit. Mention an invoice number or filename to narrow the question.");
    const { totals, excluded } = await readBillTotals(ownerUserId, billId);
    return fromRecords(`${totals.length ? `Sum of saved bill totals, kept separate by currency:\n${totals.join("\n")}` : "No bill totals with a known currency are available in this scope."}${excluded ? `\nExcluded ${excluded} bill${excluded === 1 ? "" : "s"} with a missing amount or unknown/ambiguous currency.` : ""}\nThese are saved document totals, not confirmation of payment.`);
  }
  let billIds: string[] | null = null;
  let excludedNote = "";
  if (filtered || ["count", "list", "total"].includes(plan.operation)) {
    const selected = await selectStructuredBills(ownerUserId, billId, plan);
    if (!selected) return fromRecords("This request exceeds the current 10,000-bill metadata limit. Narrow the document scope before retrying.");
    if (["count", "list", "total"].includes(plan.operation)) return fromRecords(formatStructuredAnswer(plan, selected));
    billIds = selected.bills.map((bill) => bill.billId);
    if (!billIds.length) return fromRecords(`No saved bills match the requested metadata filters.${describeBillFilters(plan.filters)}${selected.excluded ? ` ${selected.excluded} bills have missing or unusable filter fields.` : ""}`);
    indexing = await readChatIndexing(ownerUserId, billId, billIds);
    if (selected.excluded) excludedNote = `\n\nExcluded ${selected.excluded} bills with missing or unusable fields required by the metadata filters.`;
  }
  if (!indexing.readyBills) {
    return fromRecords(indexing.totalBills
      ? "Your saved bills do not have searchable text ready yet. Finish preparing their embeddings, then try again."
      : "Upload and process a bill first, then ask a question about it.");
  }
  if (plan.operation === "summary") {
    if (indexing.readyBills !== indexing.totalBills) return fromRecords(`Only ${indexing.readyBills} of ${indexing.totalBills} documents have searchable text ready. Finish preparing the remaining documents before requesting a complete summary.`);
    const sources = await readSummarySources(ownerUserId, billId, billIds);
    if (!sources) return fromRecords("This collection is too large for a complete summary in one response. Mention an invoice number or filename to narrow your question.");
    if (!sources.length) return fromRecords("No searchable text is available in this scope.");
    const answer = await generateChatAnswer(`${question}\nSummarize each supplied document separately by filename. All indexed text sections in the selected scope are supplied.`, history, sources, signal, "summary");
    return { ...answer, answer: answer.answer + excludedNote, indexing, contextBillId: billId };
  }
  const previous = history.filter((message) => message.role === "user").slice(-1)[0]?.content;
  const searchText = previous && plan.scope === "current" && !billId ? `${Array.from(previous).slice(0, 500).join("")}\n${question}` : question;
  const [vector] = await embedTexts([searchText], "search_query", signal);
  const sources = await retrieveChatSources(ownerUserId, vector, billId, billIds);
  if (!sources.length) return fromRecords("I couldn't find matching bill text for that question. Try mentioning a product, vendor, or invoice detail.");
  const answer = await generateChatAnswer(question, history, sources, signal);
  const citedBills = new Set(answer.sources.map((source) => source.billId));
  return { ...answer, answer: answer.answer + excludedNote, indexing, contextBillId: billId || (citedBills.size === 1 ? [...citedBills][0] : null) };
}
