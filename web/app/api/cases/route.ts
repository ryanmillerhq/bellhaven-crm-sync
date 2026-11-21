import { listCases } from "@/lib/cases";
import { errorResponse, json } from "@/lib/http";
import type { CaseKind, CaseStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/cases?status=pending,failed&kind=chow: list review cases (superseded hidden unless asked for). */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status")?.split(",").filter(Boolean) as CaseStatus[] | undefined;
    const kind = (url.searchParams.get("kind") || undefined) as CaseKind | undefined;
    const cases = await listCases({ status: status?.length ? status : undefined, kind });
    return json({ cases, count: cases.length });
  } catch (e) {
    return errorResponse(e);
  }
}
