import { getCase } from "@/lib/cases";
import { errorResponse, json, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/cases/:id: one case with its evidence, SOP check, planned operations and audit events. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await params).id);
    if (!id) return json({ error: "Invalid case id" }, 400);
    const c = await getCase(id);
    return c ? json({ case: c }) : json({ error: `Case ${id} not found` }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
