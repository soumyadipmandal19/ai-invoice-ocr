import { handleLogout } from "@/lib/server/auth/handlers";

export async function POST(request: Request) {
  return handleLogout(request);
}
