import { getProgress } from "@/lib/cases";
import { errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/progress: decided/total overall and per case kind. */
export async function GET() {
  try {
    return json({ progress: await getProgress() });
  } catch (e) {
    return errorResponse(e);
  }
}
