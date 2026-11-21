import { searchCrm } from "@/lib/cases";
import { errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/crm/accounts?q=kettering: read-only CRM search proxied server-side (token never leaves the server). */
export async function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
    const accounts = await searchCrm(q);
    return json({ accounts, count: accounts.length });
  } catch (e) {
    return errorResponse(e);
  }
}
