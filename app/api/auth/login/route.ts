import { handleCredentials } from "@/lib/server/auth/handlers";

export async function POST(request: Request) {
  return handleCredentials(request, "signin");
}
