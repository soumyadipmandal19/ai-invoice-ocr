import { handleChatDocuments } from "@/lib/server/chat/documents";

export async function GET(request: Request) {
  return handleChatDocuments(request);
}
