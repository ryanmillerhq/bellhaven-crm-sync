import { beforeAll, describe, expect, it } from "vitest";
import * as approveRoute from "@/app/api/cases/[id]/approve/route";
import * as rejectRoute from "@/app/api/cases/[id]/reject/route";
import * as reopenRoute from "@/app/api/cases/[id]/reopen/route";

// Mock mode: in-memory store + fake CRM; no passcode configured (local), so only the reviewer rule applies.
beforeAll(() => {
  process.env.DATA_SOURCE = "mock";
  delete process.env.REVIEW_PASSCODE;
});

const ROUTES = { approve: approveRoute, reject: rejectRoute, reopen: reopenRoute };

const call = async (path: keyof typeof ROUTES, id: number, headers: Record<string, string>, body: unknown = {}) => {
  const req = new Request(`http://local/api/cases/${id}/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return ROUTES[path].POST(req, { params: Promise.resolve({ id: String(id) }) });
};

describe("write routes require x-reviewer", () => {
  it("rejects approve, reject and reopen without x-reviewer (400) and writes nothing", async () => {
    for (const path of ["approve", "reject", "reopen"] as const) {
      const res = await call(path, 1, {});
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/x-reviewer/);
    }
    const { deps } = await import("@/lib/cases");
    expect((await deps().store.get(1))!.status).toBe("pending");
  });

  it("accepts the call with x-reviewer and records it with via=mcp", async () => {
    const res = await call("reject", 2, { "x-reviewer": "Ryan Miller (via Claude MCP)" }, { reason: "testing" });
    expect(res.status).toBe(200);
    const { case: c } = await res.json();
    expect(c).toMatchObject({ status: "rejected", decided_by: "Ryan Miller (via Claude MCP)", decided_via: "mcp" });
  });

  it("still enforces the passcode (401) before the reviewer check when one is configured", async () => {
    process.env.REVIEW_PASSCODE = "s3cret";
    try {
      expect((await call("approve", 3, { "x-reviewer": "Ryan" })).status).toBe(401);
      const ok = await call("approve", 3, { "x-reviewer": "Ryan", "x-review-passcode": "s3cret" });
      expect(ok.status).toBe(200);
      expect((await ok.json()).case.decided_by).toBe("Ryan");
    } finally {
      delete process.env.REVIEW_PASSCODE;
    }
  });
});
