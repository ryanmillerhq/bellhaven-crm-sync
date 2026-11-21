import { approve } from "@/lib/cases";
import { authorizeWrite, errorResponse, json, parseId, readJson } from "@/lib/http";
import type { Edits } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/cases/:id/approve  {edits?: {opId: {field: value}}, note?: string, expected_updated_at?: string}
 * Headers: x-reviewer (required, who is deciding), x-review-passcode (when a passcode is configured).
 * Send expected_updated_at (the case's updated_at you reviewed) so a case refreshed in the meantime is not executed.
 * Runs the case's operations through the shared executor.
 * 200 applied · 409 not approvable / refreshed (code) · 422 stale/failed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeWrite(req);
  if (auth.denied) return auth.denied;
  try {
    const id = parseId((await params).id);
    if (!id) return json({ error: "Invalid case id" }, 400);
    const body = await readJson<{ edits: Edits; note: string; expected_updated_at: string }>(req);
    const { case: c, outcome } = await approve(id, {
      edits: body.edits ?? {}, note: body.note ?? null, actor: auth.actor, expectedUpdatedAt: body.expected_updated_at ?? null,
    });
    return json({ outcome, case: c }, outcome === "applied" ? 200 : 422);
  } catch (e) {
    return errorResponse(e);
  }
}
