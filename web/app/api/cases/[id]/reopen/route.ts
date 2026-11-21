import { reopen } from "@/lib/cases";
import { authorizeWrite, errorResponse, json, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/cases/:id/reopen: puts a rejected or stale case back in the queue (with x-reviewer). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeWrite(req);
  if (auth.denied) return auth.denied;
  try {
    const id = parseId((await params).id);
    if (!id) return json({ error: "Invalid case id" }, 400);
    return json({ case: await reopen(id, { actor: auth.actor }) });
  } catch (e) {
    return errorResponse(e);
  }
}
