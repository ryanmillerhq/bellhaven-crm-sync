import { mockCrm } from "@/lib/cases";
import { json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Mock mode only: change a field on the FAKE CRM to simulate the real CRM drifting after a case was proposed,
 * so the stale-precondition path can be demoed. Returns 404 outside DATA_SOURCE=mock.
 */
export async function POST(req: Request) {
  const crm = mockCrm();
  if (!crm) return json({ error: "Not found" }, 404);
  const { account_id, field, value } = await readJson<{ account_id: string; field: string; value: unknown }>(req);
  const acct = account_id ? crm.accounts.get(account_id) : undefined;
  if (!acct || !field) return json({ error: "account_id and field are required" }, 400);
  (acct as Record<string, unknown>)[field] = value;
  return json({ ok: true, account: acct });
}
