// Executor hardening from the red-team review: retry precondition scoping, idempotent creates, apply lease,
// content-version guard, reopen rules, ""/null equivalence.
import { beforeEach, describe, expect, it } from "vitest";
import { approveCase, CaseConflict, CaseRefreshed, reopenCase, sameValue, type ExecDeps } from "@/lib/executor";
import { MemoryCaseStore } from "@/lib/store";
import { FakeCrm } from "@/lib/mock/fake-crm";
import { BELLHAVEN_ID, buildMockCases, snapshotAccounts, snapshotContacts } from "@/lib/mock/cases";
import type { Case } from "@/lib/types";

const actor = { name: "Ryan Miller", via: "ui" as const };
let cases: Case[];
let store: MemoryCaseStore;
let crm: FakeCrm;
let deps: ExecDeps;
const byTitle = (t: string) => cases.find((x) => x.title === t)!;

beforeEach(() => {
  cases = buildMockCases();
  store = new MemoryCaseStore(cases);
  crm = new FakeCrm(snapshotAccounts(), snapshotContacts());
  deps = { store, crm };
});

describe("1. retry precondition scoping", () => {
  it("doesn't go stale on retry because an earlier step of the same case already changed a checked field", async () => {
    const c = byTitle("Bellhaven of Kettering"); // survivor re-parent + rename, then retire two duplicates
    let failOnce = true;
    crm.failWhen = (call) => {
      const body = call.body as Record<string, unknown> | undefined;
      if (failOnce && call.method === "PATCH" && call.path === "/accounts/001B7XZAA3AFALS9GP" && body?.duplicate_of_account) {
        failOnce = false;
        return new Error("CRM PATCH → 503");
      }
      return null;
    };
    const first = await approveCase(deps, c.id, { actor });
    expect(first.outcome).toBe("failed");
    expect(crm.accounts.get("0016KTS1UAWBRXS09J")!.parent_id).toBe(BELLHAVEN_ID); // survivor already moved (precondition said "")

    const retry = await approveCase(deps, c.id, { actor });
    expect(retry.outcome).toBe("applied");
    expect(crm.accounts.get("001B7XZAA3AFALS9GP")).toMatchObject({ status: "Inactive", duplicate_of_account: "0016KTS1UAWBRXS09J" });
  });

  it("still re-checks accounts that have unfinished work", async () => {
    const c = byTitle("Bellhaven of Kettering");
    let failOnce = true;
    crm.failWhen = (call) => (failOnce && call.method === "PATCH" && call.path === "/accounts/001B7XZAA3AFALS9GP" ? ((failOnce = false), new Error("503")) : null);
    await approveCase(deps, c.id, { actor });
    crm.accounts.get("001B7XZAA3AFALS9GP")!.status = "Needs Review"; // someone changed the unfinished duplicate meanwhile
    const retry = await approveCase(deps, c.id, { actor });
    expect(retry.outcome).toBe("stale");
  });
});

describe("2. idempotent create", () => {
  it("adopts an identical account that already exists instead of creating a duplicate", async () => {
    const c = byTitle("Bellhaven of Batavia");
    const create = c.operations.find((o) => o.op === "create_account")!;
    if (create.op !== "create_account") throw new Error();
    const { id: existing } = await crm.createAccount({ ...create.fields, note: "created by hand" }); // e.g. a rep made it meanwhile
    crm.calls.length = 0;

    const { case: done } = await approveCase(deps, c.id, { actor });
    expect(done.status).toBe("applied");
    expect(done.result![0]).toMatchObject({ created_id: existing, adopted: true });
    expect(crm.writes.filter((w) => w.method === "POST")).toHaveLength(0);
  });

  it("recovers from a POST that succeeded but timed out: the retry adopts it, no second account", async () => {
    const c = byTitle("Bellhaven of Batavia");
    const realCreate = crm.createAccount.bind(crm);
    let timeouts = 1;
    crm.createAccount = async (fields) => {
      const r = await realCreate(fields);
      if (timeouts-- > 0) throw new Error("timeout after 30s");
      return r;
    };
    expect((await approveCase(deps, c.id, { actor })).outcome).toBe("failed");
    const retry = await approveCase(deps, c.id, { actor });
    expect(retry.outcome).toBe("applied");
    expect(retry.case.result!.find((r) => r.ok)!.adopted).toBe(true);
    expect([...crm.accounts.values()].filter((a) => a.name === "Bellhaven of Batavia")).toHaveLength(1);
  });

  it("never adopts the CHOW case's own old record, even though it has the same name and address", async () => {
    const c = byTitle("Bellhaven of Tiffin");
    const { case: done } = await approveCase(deps, c.id, { actor });
    const created = done.result!.find((r) => r.created_id)!;
    expect(created.adopted).toBeFalsy();
    expect(created.created_id).not.toBe("001U6RW32TY0WSXZZB");
    expect(crm.accounts.get("001U6RW32TY0WSXZZB")!.chow_current_account).toBe(created.created_id);
  });
});

describe("3. lease on applying", () => {
  it("re-claims a case stuck in 'applying' for more than 10 minutes, but not a fresh one", async () => {
    const c = byTitle("Bellhaven of Chagrin Falls");
    store.touch(c.id, { status: "applying" }, new Date(Date.now() - 2 * 60_000).toISOString());
    await expect(approveCase(deps, c.id, { actor })).rejects.toBeInstanceOf(CaseConflict);

    store.touch(c.id, { status: "applying" }, new Date(Date.now() - 11 * 60_000).toISOString());
    expect((await approveCase(deps, c.id, { actor })).outcome).toBe("applied");
  });
});

describe("4. content-version guard", () => {
  it("refuses to execute a case the pipeline refreshed after the reviewer opened it", async () => {
    const c = byTitle("Bellhaven Crossings of Lima");
    const seen = c.updated_at!;
    store.touch(c.id, { reasoning: [...c.reasoning, "refreshed by run #5"] }); // pipeline refresh during the Undo window

    await expect(approveCase(deps, c.id, { actor, expectedUpdatedAt: seen })).rejects.toBeInstanceOf(CaseRefreshed);
    expect(crm.writes).toHaveLength(0);
    expect((await store.get(c.id))!.status).toBe("pending");

    const fresh = (await store.get(c.id))!.updated_at!;
    expect((await approveCase(deps, c.id, { actor, expectedUpdatedAt: fresh })).outcome).toBe("applied");
  });
});

describe("5. reopen rules", () => {
  it("never reopens applied or applying cases", async () => {
    const c = byTitle("Bellhaven of Chagrin Falls");
    await approveCase(deps, c.id, { actor });
    await expect(reopenCase(deps, c.id, { actor })).rejects.toBeInstanceOf(CaseConflict);
    const d = byTitle("Bellhaven of Chesterton");
    store.touch(d.id, { status: "applying" });
    await expect(reopenCase(deps, d.id, { actor })).rejects.toBeInstanceOf(CaseConflict);
  });

  it("reopens a stale case but keeps its result history", async () => {
    const c = byTitle("Bellhaven of Chesterton");
    const history = [{ op_id: "opX", ok: true, at: "2026-11-21T20:00:00.000Z", actor: "Ryan Miller", via: "ui" as const }];
    store.touch(c.id, { status: "stale", result: history, error: "drifted" });
    const reopened = await reopenCase(deps, c.id, { actor });
    expect(reopened.status).toBe("pending");
    expect(reopened.result).toEqual(history);
    expect(reopened.error).toBeNull();
  });
});

describe("6. empty string and null are the same CRM value", () => {
  it("compares blank values as equal in preconditions", async () => {
    expect(sameValue(null, "")).toBe(true);
    expect(sameValue("", null)).toBe(true);
    expect(sameValue(undefined, "  ")).toBe(true);
    expect(sameValue("001X", "")).toBe(false);

    const c = byTitle("Bellhaven of Port Clinton"); // survivor preconditions: duplicate_of_account == "", chow == ""
    const survivor = c.accounts.find((a) => a.role === "survivor")!.account.account_id;
    Object.assign(crm.accounts.get(survivor)!, { duplicate_of_account: null, chow_current_account: null });
    expect((await approveCase(deps, c.id, { actor })).outcome).toBe("applied");
  });
});
