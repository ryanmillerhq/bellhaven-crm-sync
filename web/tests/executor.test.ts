import { beforeEach, describe, expect, it } from "vitest";
import { approveCase, CaseConflict, rejectCase, reopenCase, type ExecDeps } from "@/lib/executor";
import { MemoryCaseStore } from "@/lib/store";
import { FakeCrm } from "@/lib/mock/fake-crm";
import { BELLHAVEN_ID, buildMockCases, snapshotAccounts, snapshotContacts } from "@/lib/mock/cases";
import type { Case } from "@/lib/types";

const actor = { name: "test-reviewer", via: "ui" as const };
let cases: Case[];
let store: MemoryCaseStore;
let crm: FakeCrm;
let deps: ExecDeps;

const byTitle = (t: string) => {
  const c = cases.find((x) => x.title === t);
  if (!c) throw new Error(`no case ${t}`);
  return c;
};
/** Real op ids are sequential across a pipeline run (op23, op24, ...), so tests find operations by type. */
const opId = (c: Case, type: Case["operations"][number]["op"], nth = 0) => c.operations.filter((o) => o.op === type)[nth].id;

beforeEach(() => {
  cases = buildMockCases();
  store = new MemoryCaseStore(cases);
  crm = new FakeCrm(snapshotAccounts(), snapshotContacts());
  deps = { store, crm };
});

describe("CHOW (Tiffin)", () => {
  it("creates the new account under Bellhaven and links the old one via $ref, leaving the old parent alone", async () => {
    const c = byTitle("Bellhaven of Tiffin");
    const { outcome, case: done } = await approveCase(deps, c.id, { actor });

    expect(outcome).toBe("applied");
    expect(done.status).toBe("applied");
    const created = done.result!.find((r) => r.op_id === opId(c, "create_account"))!.created_id!;
    expect(created).toMatch(/^001MOCK/);
    expect(crm.accounts.get(created)).toMatchObject({ name: "Bellhaven of Tiffin", parent_id: BELLHAVEN_ID, billing_zip: "44883" });

    const old = crm.accounts.get("001U6RW32TY0WSXZZB")!;
    expect(old.chow_current_account).toBe(created);
    expect(old.parent_id).toBe("001FWSQ30SFW6S7604"); // still Cedar Trail, per SOP
    expect(crm.writes.map((w) => `${w.method} ${w.path}`)).toEqual(["POST /accounts", "PATCH /accounts/001U6RW32TY0WSXZZB"]);
    expect((await store.events(c.id)).map((e) => e.event)).toEqual(["claimed", "approved", "op_applied", "op_applied", "applied"]);
  });

  it("applies reviewer edits to editable fields only", async () => {
    const c = byTitle("Bellhaven of Tiffin");
    await approveCase(deps, c.id, { actor, edits: { [opId(c, "create_account")]: { name: "Bellhaven of Tiffin (Edited)", parent_id: "HACK" } } });
    const post = crm.writes.find((w) => w.method === "POST")!;
    expect(post.body).toMatchObject({ name: "Bellhaven of Tiffin (Edited)", parent_id: BELLHAVEN_ID });
  });
});

describe("precondition drift", () => {
  it("marks the case stale and writes nothing when the CRM changed since proposal", async () => {
    const c = byTitle("Bellhaven of Tiffin");
    crm.accounts.get("001U6RW32TY0WSXZZB")!.outstanding_ar = 0; // AR got paid off → SOP branch would flip
    const { outcome, case: done } = await approveCase(deps, c.id, { actor });

    expect(outcome).toBe("stale");
    expect(done.status).toBe("stale");
    expect(done.error).toContain("outstanding_ar");
    expect(crm.writes).toHaveLength(0);
  });
});

describe("double claim", () => {
  it("lets exactly one of two simultaneous approvals through", async () => {
    const c = byTitle("Bellhaven of Tiffin");
    const results = await Promise.allSettled([approveCase(deps, c.id, { actor }), approveCase(deps, c.id, { actor })]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(CaseConflict);
    expect(crm.writes.filter((w) => w.method === "POST")).toHaveLength(1);
  });

  it("refuses to approve an already-applied case", async () => {
    const c = byTitle("Bellhaven of Chagrin Falls");
    await approveCase(deps, c.id, { actor });
    await expect(approveCase(deps, c.id, { actor })).rejects.toBeInstanceOf(CaseConflict);
  });
});

describe("partial failure and retry", () => {
  it("resumes after the failed step without creating the account twice", async () => {
    const c = byTitle("Bellhaven of Tiffin");
    let failures = 1;
    crm.failWhen = (call) => (call.method === "PATCH" && failures-- > 0 ? new Error("CRM PATCH → 503") : null);

    const first = await approveCase(deps, c.id, { actor, edits: { [opId(c, "create_account")]: { name: "Bellhaven of Tiffin" } } });
    expect(first.outcome).toBe("failed");
    expect(first.case.result!.map((r) => [r.op_id, r.ok])).toEqual([[opId(c, "create_account"), true], [opId(c, "update_account"), false]]);
    const created = first.case.result![0].created_id!;

    const retry = await approveCase(deps, c.id, { actor });
    expect(retry.outcome).toBe("applied");
    expect(crm.writes.filter((w) => w.method === "POST")).toHaveLength(1);
    expect(crm.accounts.get("001U6RW32TY0WSXZZB")!.chow_current_account).toBe(created);
    expect((await store.events(c.id)).map((e) => e.event)).toEqual(
      ["claimed", "approved", "op_applied", "op_failed", "failed", "claimed", "retry", "op_applied", "applied"]);
  });
});

describe("audit identity", () => {
  const ryan = { name: "Ryan Miller (ryan@example.com)", via: "ui" as const };

  it("stamps the reviewer on the case, every event and every operation result when approving", async () => {
    const c = byTitle("Bellhaven of Tiffin");
    const { case: done } = await approveCase(deps, c.id, { actor: ryan, note: "SOP checked" });
    expect(done).toMatchObject({ decided_by: ryan.name, decided_via: "ui", decision_note: "SOP checked" });
    for (const r of done.result!) expect(r).toMatchObject({ actor: ryan.name, via: "ui", at: expect.any(String) });
    const events = await store.events(c.id);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e).toMatchObject({ actor: ryan.name, via: "ui" });
  });

  it("stamps the reviewer when rejecting and reopening", async () => {
    const c = byTitle("Bellhaven of Batavia");
    const rejected = await rejectCase(deps, c.id, { actor: { name: "Ryan Miller", via: "mcp" }, reason: "dup of a pending create" });
    expect(rejected).toMatchObject({ decided_by: "Ryan Miller", decided_via: "mcp" });
    await reopenCase(deps, c.id, { actor: ryan });
    expect((await store.events(c.id)).map((e) => [e.event, e.actor, e.via])).toEqual([
      ["rejected", "Ryan Miller", "mcp"], ["reopened", ryan.name, "ui"],
    ]);
  });

  it("suffixes every note it writes into the CRM with who approved it and how", async () => {
    const lima = byTitle("Bellhaven Crossings of Lima");
    await approveCase(deps, lima.id, { actor: { name: "Ryan Miller (via Claude MCP)", via: "mcp" } });
    const limaNote = crm.accounts.get("001LGFPBJY4N9MB6KL")!.note;
    expect(limaNote).toMatch(/^\[bellhaven-sync 2026-11-21\] /);
    expect(limaNote.endsWith(" Approved by Ryan Miller (via Claude MCP) via mcp.")).toBe(true);

    const tiffin = byTitle("Bellhaven of Tiffin");
    await approveCase(deps, tiffin.id, { actor: ryan });
    const post = crm.writes.find((w) => w.method === "POST")!.body as { note: string };
    expect(post.note.endsWith(`Approved by ${ryan.name} via ui.`)).toBe(true);
  });
});

describe("notes", () => {
  it("appends to an existing note instead of overwriting it", async () => {
    const c = byTitle("Bellhaven Crossings of Lima");
    crm.accounts.get("001LGFPBJY4N9MB6KL")!.note = "Existing rep note: call Tues.";
    await approveCase(deps, c.id, { actor });
    const note = crm.accounts.get("001LGFPBJY4N9MB6KL")!.note;
    expect(note.startsWith("Existing rep note: call Tues.\n[bellhaven-sync")).toBe(true);
    expect(crm.accounts.get("001LGFPBJY4N9MB6KL")!.parent_id).toBe(BELLHAVEN_ID);
  });
});

describe("duplicates", () => {
  it("retires the loser, points it at the survivor and moves its active contact", async () => {
    const c = byTitle("Bellhaven of Owosso");
    await approveCase(deps, c.id, { actor });
    expect(crm.accounts.get("001QU150PM4Z15UA71")).toMatchObject({ status: "Inactive", duplicate_of_account: "001EGU7BMJ942ZTRE6" });
    expect(crm.contacts.get("003BT8QV7PS7S0XM0P")!.account_id).toBe("001EGU7BMJ942ZTRE6");
  });

  it("re-parents and renames the Kettering survivor while retiring two duplicates", async () => {
    const c = byTitle("Bellhaven of Kettering");
    await approveCase(deps, c.id, { actor });
    expect(crm.accounts.get("0016KTS1UAWBRXS09J")).toMatchObject({ parent_id: BELLHAVEN_ID, name: "Bellhaven of Kettering" });
    for (const id of ["001WR41PYNWXCAE2X4", "001B7XZAA3AFALS9GP"]) {
      expect(crm.accounts.get(id)).toMatchObject({ status: "Inactive", duplicate_of_account: "0016KTS1UAWBRXS09J" });
    }
  });
});

describe("reject and reopen", () => {
  it("rejects without touching the CRM, then reopens back to pending", async () => {
    const c = byTitle("Bellhaven at Sycamore Ridge");
    const rejected = await rejectCase(deps, c.id, { actor, reason: "Cosmetic; leave the CRM name" });
    expect(rejected).toMatchObject({ status: "rejected", decision_note: "Cosmetic; leave the CRM name" });
    expect(crm.writes).toHaveLength(0);

    const reopened = await reopenCase(deps, c.id, { actor });
    expect(reopened).toMatchObject({ status: "pending", decided_at: null, decision_note: null });
    await expect(reopenCase(deps, c.id, { actor })).rejects.toBeInstanceOf(CaseConflict);
  });
});
