import { NextResponse } from "next/server";
import { canWrite, passcodeRequired } from "@/lib/auth";
import { dataMode } from "@/lib/cases";

export const dynamic = "force-dynamic";

/**
 * GET /crm/:accountId → redirect to the account in the CRM browser.
 * The CRM browser URL embeds the API token, so the link is built here, server-side, and only for reviewers who
 * may act (when a passcode is configured). The token never appears in any page or client bundle.
 */
export async function GET(req: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const id = (await params).accountId;
  if (!/^[A-Za-z0-9]{6,40}$/.test(id)) return new NextResponse("Invalid account id", { status: 400 });
  if (passcodeRequired() && !(await canWrite(req))) {
    return new NextResponse("Unlock the review app with the passcode to open CRM records.", { status: 401 });
  }
  const token = process.env.CRM_API_TOKEN;
  const site = (process.env.SITE_BASE_URL ?? "https://analyst-assessment-production.up.railway.app").replace(/\/$/, "");
  if (!token || (dataMode() === "mock" && id.startsWith("001MOCK"))) {
    return new NextResponse(`Account ${id} exists only in mock mode (no CRM record to open).`, { status: 404 });
  }
  return NextResponse.redirect(`${site}/crm/${encodeURIComponent(token)}/accounts/${encodeURIComponent(id)}`, 302);
}
