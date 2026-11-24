import { handleEmbeddingStatus, handleIndexEmbeddings } from "@/lib/server/embeddings/handlers";

export const GET = handleEmbeddingStatus;
export const POST = handleIndexEmbeddings;
