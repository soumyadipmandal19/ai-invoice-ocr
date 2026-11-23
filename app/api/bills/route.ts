import { handleSaveBill, handleListBills } from "@/lib/server/bills/handlers";

export async function POST(request: Request) {
  return handleSaveBill(request);
}

export async function GET(request: Request) {
  return handleListBills(request);
}
