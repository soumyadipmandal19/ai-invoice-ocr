import { handleReadBill, handleDeleteBill } from "@/lib/server/bills/handlers";

export async function GET(_request: Request, context: RouteContext<"/api/bills/[id]">) {
  const { id } = await context.params;
  return handleReadBill(id);
}

export async function DELETE(request: Request, context: RouteContext<"/api/bills/[id]">) {
  const { id } = await context.params;
  return handleDeleteBill(request, id);
}
