import { endSession, passcodeRequired, startSession } from "@/lib/auth";
import { json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/session {passcode}: unlock writes for this browser (sets the signed cookie). DELETE locks again. */
export async function POST(req: Request) {
  const { passcode } = await readJson<{ passcode: string }>(req);
  if (!passcodeRequired()) return json({ ok: true, required: false });
  return (await startSession(String(passcode ?? ""))) ? json({ ok: true }) : json({ ok: false, error: "Wrong passcode" }, 401);
}

export async function DELETE() {
  await endSession();
  return json({ ok: true });
}
