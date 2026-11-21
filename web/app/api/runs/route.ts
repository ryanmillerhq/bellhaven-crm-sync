import { getRuns } from "@/lib/cases";
import { errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/runs?limit=10: recent pipeline runs with counts and scrape report. */
export async function GET(req: Request) {
  try {
    const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 10));
    return json({ runs: await getRuns(limit) });
  } catch (e) {
    return errorResponse(e);
  }
}
