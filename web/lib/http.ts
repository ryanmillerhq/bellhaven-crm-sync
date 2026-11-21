import "server-only";
import { NextResponse } from "next/server";
import { actorFromRequest, canWrite } from "./auth";
import { CrmError } from "./crm";
import { CaseConflict, CaseNotFound, CaseRefreshed } from "./executor";
import type { Actor } from "./types";

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function errorResponse(e: unknown) {
  if (e instanceof CaseNotFound) return json({ error: e.message }, 404);
  if (e instanceof CaseRefreshed) return json({ error: e.message, code: "refreshed" }, 409);
  if (e instanceof CaseConflict) return json({ error: e.message, code: "conflict" }, 409);
  if (e instanceof CrmError) return json({ error: e.message, status: e.status }, 502);
  console.error(e);
  return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
}

/**
 * Gate for every write route: passcode rule first (401), then a reviewer identity (400). Every write goes through
 * one shared CRM token, so the `x-reviewer` header is what the audit trail records.
 */
export async function authorizeWrite(req: Request): Promise<{ actor: Actor; denied?: never } | { denied: Response; actor?: never }> {
  if (!(await canWrite(req))) {
    return { denied: json({ error: "Passcode required: send the x-review-passcode header or unlock in the review app." }, 401) };
  }
  const actor = actorFromRequest(req);
  if (!actor) {
    return { denied: json({ error: "Missing x-reviewer header: say who is making this decision, e.g. \"Ryan Miller (via Claude MCP)\"." }, 400) };
  }
  return { actor };
}

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    const text = await req.text();
    return text ? (JSON.parse(text) as Partial<T>) : {};
  } catch {
    return {};
  }
}
