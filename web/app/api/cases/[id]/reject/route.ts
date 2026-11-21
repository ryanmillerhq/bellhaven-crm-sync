import { reject } from "@/lib/cases";
import { authorizeWrite, errorResponse, json, parseId, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/cases/:id/reject  {reason?: string}: records the decision (with x-reviewer); never touches the CRM. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeWrite(req);
  if (auth.denied) return auth.denied;
  try {
    const id = parseId((await params).id);
    if (!id) return json({ error: "Invalid case id" }, 400);
    const body = await readJson<{ reason: string }>(req);
    return json({ case: await reject(id, { reason: body.reason ?? null, actor: auth.actor }) });
  } catch (e) {
    return errorResponse(e);
  }
}
