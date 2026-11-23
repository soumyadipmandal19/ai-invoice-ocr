import "server-only";

import { getUser } from "@/lib/server/auth/session";
import { saveOrganizedBill, deleteSavedBill, BillSaveError } from "@/lib/server/bills/service";
import { BillOwnerMissingError, readBillOutputs, listUserBills } from "@/lib/server/bills/store";
import { checkOrigin, readInput, RequestError } from "@/lib/server/http/request";

const headers = { "Cache-Control": "no-store" };
const VALID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function handleSaveBill(request: Request) {
  try {
    checkOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    const input = await readInput(request);
    if (typeof input.jobId !== "string" || !VALID_ID.test(input.jobId)) {
      throw new RequestError("A valid jobId from /api/extract is required.", 400);
    }
    const saved = await saveOrganizedBill(input.jobId, user.id);
    return Response.json(saved, { headers });
  } catch (error) {
    if (error instanceof RequestError || error instanceof BillSaveError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof BillOwnerMissingError) return Response.json({ error: "The bill or upload account is no longer available." }, { status: 404, headers });
    console.error("Bill persistence request failed.");
    return Response.json({ error: "Unable to save the bill. Please retry when the database is available." }, { status: 503, headers });
  }
}

export async function handleDeleteBill(request: Request, billId: string) {
  try {
    checkOrigin(request);
    const user = await getUser();
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    if (!VALID_ID.test(billId)) throw new RequestError("A valid bill ID is required.", 400);
    const input = await readInput(request);
    if (input.confirmation !== "DELETE") throw new RequestError("Confirm bill deletion before continuing.", 400);
    if (!(await deleteSavedBill(billId, user.id))) return Response.json({ error: "Bill not found." }, { status: 404, headers });
    return Response.json({ success: true, billId }, { headers });
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Unable to finish deleting the bill. Please retry." }, { status: 503, headers });
  }
}

export async function handleReadBill(billId: string) {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    if (!VALID_ID.test(billId)) return Response.json({ error: "A valid bill ID is required." }, { status: 400, headers });
    const result = await readBillOutputs(billId, user.id);
    if (!result) return Response.json({ error: "Bill not found." }, { status: 404, headers });
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "Unable to load bill outputs. Please try again." }, { status: 503, headers });
  }
}

export async function handleListBills(request: Request) {
  try {
    const user = await getUser();
    if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    const offsetText = params.get("offset") ?? "0";
    const limitText = params.get("limit") ?? "25";
    if (!/^\d+$/.test(offsetText) || !/^\d+$/.test(limitText)) throw new RequestError("offset and limit must be integers.", 400);
    const offset = Number(offsetText);
    const limit = Number(limitText);
    if (!Number.isSafeInteger(offset) || offset > 1_000_000 || limit < 1 || limit > 50) throw new RequestError("Use offset 0–1000000 and limit 1–50.", 400);
    // Ownership always comes from the session, never from a query-string user ID.
    return Response.json(await listUserBills(user.id, offset, limit), { headers });
  } catch (error) {
    if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "Unable to load saved documents. Please try again." }, { status: 503, headers });
  }
}
