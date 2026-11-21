import { getCrmAccount } from "@/lib/cases";
import { errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/crm/accounts/:id: one CRM account with its contacts (read-only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    if (!/^[A-Za-z0-9]{6,40}$/.test(id)) return json({ error: "Invalid account id" }, 400);
    return json(await getCrmAccount(id));
  } catch (e) {
    return errorResponse(e);
  }
}
