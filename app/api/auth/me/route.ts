import { handleCurrentUser, handleDeleteAccount } from "@/lib/server/auth/handlers";

export async function GET() {
  return handleCurrentUser();
}

export async function DELETE(request: Request) {
  return handleDeleteAccount(request);
}
