/**
 * Generic case executor (docs/case-contract.md, "Executor rules").
 *
 * It contains no business rules. Matching, CHOW and duplicate decisions were made by the pipeline and are
 * expressed as an ordered list of operations. This module only:
 *   1. claims the case atomically (a double-click can't write twice; a dead run's lease expires after 10 min;
 *      the reviewer's copy must still be the current version),
 *   2. re-checks the CRM values the proposal assumed (drift → "stale", nothing written),
 *   3. runs the operations in order, resolving {$ref} ids and recording every result (resume-safe retries;
 *      creates are idempotent: an identical account that already exists is adopted, not duplicated),
 *   4. records the outcome, stamped with who did it, in the case and its audit trail.
 */
import type { CrmClient } from "./crm";
import type { CaseStore } from "./store";
import type { Actor, Case, CaseStatus, CrmAccount, Edits, Operation, OperationResult, Precondition, Ref, Value } from "./types";

export interface ExecDeps { store: CaseStore; crm: CrmClient; now?: () => Date }

export class CaseNotFound extends Error {}
export class CaseConflict extends Error {}
/** The case changed (e.g. the pipeline refreshed it) after the reviewer opened it. → 409, re-review. */
export class CaseRefreshed extends CaseConflict {}

export type Outcome = "applied" | "stale" | "failed";

/** A case left in 'applying' this long (serverless function died mid-run) may be claimed again. */
export const APPLY_LEASE_MS = 10 * 60 * 1000;

const isRef = (v: unknown): v is Ref => !!v && typeof v === "object" && "$ref" in (v as object);

/** Apply reviewer edits, but only to fields the pipeline marked editable for that operation. */
export function applyEdits(ops: Operation[], edits: Edits = {}): Operation[] {
  return ops.map((op) => {
    if (op.op !== "create_account" && op.op !== "update_account") return op;
    const e = edits[op.id];
    if (!e) return op;
    const fields = { ...op.fields };
    for (const [k, v] of Object.entries(e)) {
      if (!op.editable.includes(k)) continue;
      const orig = fields[k];
      fields[k] = typeof orig === "number" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v.trim();
    }
    return { ...op, fields };
  });
}

/** Loose equality for CRM values: ""/null/undefined are the same, numbers compare numerically, strings trimmed. */
export function sameValue(actual: unknown, expected: unknown): boolean {
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  if (blank(actual) && blank(expected)) return true;
  if (typeof expected === "number" || typeof actual === "number") return Number(actual) === Number(expected);
  return String(actual ?? "").trim() === String(expected ?? "").trim();
}

function resolve(v: Value, refs: Record<string, string>): Exclude<Value, Ref> {
  if (!isRef(v)) return v;
  const id = refs[v.$ref];
  if (!id) throw new Error(`reference "${v.$ref}" has no created id yet`);
  return id;
}

function resolveFields(fields: Record<string, Value>, refs: Record<string, string>) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, resolve(v, refs)]));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The account an operation writes to (null for creates/contacts, whose target isn't a pre-existing account). */
function targetAccount(op: Operation, refs: Record<string, string>): string | null {
  if (op.op === "update_account" || op.op === "append_note") return isRef(op.account_id) ? refs[op.account_id.$ref] ?? null : op.account_id;
  return null;
}

/**
 * Idempotent create: if an identical account already exists (same address, same name, same parent, Active, no
 * duplicate/CHOW pointer), adopt it instead of POSTing a second one. Covers a POST that timed out after succeeding,
 * or someone creating it by hand meanwhile. Accounts the case itself is about (e.g. the CHOW case's OLD record,
 * which has the same name and address but must stay separate) are never adopted.
 */
async function findAdoptable(crm: CrmClient, fields: Record<string, unknown>, caseAccountIds: Set<string>): Promise<CrmAccount | null> {
  const street = String(fields.billing_street ?? "").trim();
  const zip = String(fields.billing_zip ?? "").trim();
  const name = String(fields.name ?? "").trim().toLowerCase();
  if (!street || !zip || !name) return null;
  const found = await crm.findAccounts({ street, zip });
  return found.find((a) =>
    !caseAccountIds.has(a.account_id)
    && String(a.name ?? "").trim().toLowerCase() === name
    && sameValue(a.status, "Active")
    && sameValue(a.parent_id, fields.parent_id ?? "")
    && sameValue(a.duplicate_of_account, "")
    && sameValue(a.chow_current_account, ""),
  ) ?? null;
}

export async function approveCase(
  deps: ExecDeps, id: number, opts: { edits?: Edits; note?: string | null; actor: Actor; expectedUpdatedAt?: string | null },
): Promise<{ case: Case; outcome: Outcome }> {
  const { store, crm } = deps;
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  // ---- 1. claim ----
  const claimed = await store.claim(id, { leaseMs: APPLY_LEASE_MS, expectedUpdatedAt: opts.expectedUpdatedAt, now: deps.now?.() });
  if (!claimed) {
    const existing = await store.get(id);
    if (!existing) throw new CaseNotFound(`Case ${id} not found`);
    if ((existing.status === "pending" || existing.status === "failed") && opts.expectedUpdatedAt) {
      throw new CaseRefreshed(`Case ${id} was refreshed after you opened it (e.g. by the daily pipeline run); please re-review it before approving.`);
    }
    throw new CaseConflict(`Case ${id} is ${existing.status}; only pending or failed cases can be approved`);
  }
  const { name: who, via } = opts.actor;
  await store.addEvent(id, "claimed", who, via, { prior_results: (claimed.result ?? []).length });

  const prior = (claimed.result ?? []).filter((r) => r.ok);
  const isRetry = prior.length > 0;
  // A retry replays the operations exactly as first approved (edits included) so finished steps line up.
  const ops = isRetry && claimed.final_operations ? claimed.final_operations : applyEdits(claimed.operations, opts.edits);
  const decided = { decided_by: who, decided_via: via, decision_note: opts.note ?? claimed.decision_note ?? null };
  await store.addEvent(id, isRetry ? "retry" : "approved", who, via, { edits: opts.edits ?? {}, note: opts.note ?? null });
  // Identity, not business logic: every note the executor writes into the CRM says who approved it and how,
  // because the CRM itself only ever sees the one shared API token.
  const stamp = (text: string) => `${text.trimEnd()} Approved by ${who} via ${via}.`;

  // ids created (or adopted) by earlier successful steps (retries)
  const refs: Record<string, string> = {};
  for (const r of prior) {
    const op = ops.find((o) => o.id === r.op_id);
    if (op?.op === "create_account" && r.created_id) refs[op.ref] = r.created_id;
  }

  // ---- 2. preconditions ----
  // On a retry, only accounts that still have unfinished operations are re-checked, and never the fields our own
  // finished steps changed (e.g. Kettering: the survivor was already re-parented, so its old parent_id="" no
  // longer holds, and that must not make the case stale). Guard-only accounts (no operations) are always checked.
  const done = new Set(prior.map((r) => r.op_id));
  const accountsWithWork = new Set<string>();
  const accountsWithOps = new Set<string>();
  const touched = new Set<string>();
  for (const op of ops) {
    const acct = targetAccount(op, refs);
    if (!acct) continue;
    accountsWithOps.add(acct);
    if (!done.has(op.id)) accountsWithWork.add(acct);
    else if (op.op === "update_account") for (const f of Object.keys(op.fields)) touched.add(`${acct}:${f}`);
    else if (op.op === "append_note") touched.add(`${acct}:note`);
  }
  const toCheck = claimed.preconditions.filter((p) =>
    !touched.has(`${p.account_id}:${p.field}`) && (!isRetry || accountsWithWork.has(p.account_id) || !accountsWithOps.has(p.account_id)));

  const drift: (Precondition & { actual: unknown })[] = [];
  const seen = new Map<string, Record<string, unknown>>();
  for (const p of toCheck) {
    let acct = seen.get(p.account_id);
    if (!acct) {
      try {
        acct = (await crm.getAccount(p.account_id)) as Record<string, unknown>;
      } catch (e) {
        const failed = await store.update(id, { status: "failed", error: `Could not read account ${p.account_id} to re-check it: ${message(e)}`, final_operations: ops, ...decided });
        await store.addEvent(id, "failed", who, via, { stage: "preconditions", error: message(e) });
        return { case: failed, outcome: "failed" };
      }
      seen.set(p.account_id, acct);
    }
    if (!sameValue(acct[p.field], p.equals)) drift.push({ ...p, actual: acct[p.field] ?? null });
  }
  if (drift.length) {
    const what = drift.map((d) => `${d.field} on ${d.account_id} is now ${JSON.stringify(d.actual)} (expected ${JSON.stringify(d.equals)})`).join("; ");
    const stale = await store.update(id, {
      status: "stale", final_operations: ops, error: `The CRM changed since this case was proposed: ${what}. Nothing was written; the next pipeline run will re-evaluate it.`, ...decided,
    });
    await store.addEvent(id, "stale", who, via, { drift });
    return { case: stale, outcome: "stale" };
  }

  // ---- 3. run operations in order, persisting after each one ----
  const caseAccountIds = new Set(claimed.accounts.map((a) => a.account.account_id));
  const results: OperationResult[] = [...prior];
  for (const op of ops) {
    if (results.some((r) => r.op_id === op.id && r.ok)) continue;
    try {
      const res: OperationResult = { op_id: op.id, ok: true, at: now(), actor: who, via };
      switch (op.op) {
        case "create_account": {
          const fields = resolveFields(op.fields, refs);
          const existing = await findAdoptable(crm, fields, caseAccountIds);
          if (existing) {
            refs[op.ref] = existing.account_id;
            Object.assign(res, { created_id: existing.account_id, adopted: true, response: existing });
            break;
          }
          if (typeof fields.note === "string" && fields.note) fields.note = stamp(fields.note);
          const { id: created, response } = await crm.createAccount(fields);
          refs[op.ref] = created;
          Object.assign(res, { created_id: created, response });
          break;
        }
        case "update_account": {
          const target = String(resolve(op.account_id, refs));
          const fields = resolveFields(op.fields, refs);
          if (typeof fields.note === "string" && fields.note) {
            // a note set through update_account is still appended, never a blind overwrite
            const current = String((await crm.getAccount(target)).note ?? "").trim();
            fields.note = current ? `${current}\n${stamp(fields.note)}` : stamp(fields.note);
          }
          res.response = await crm.updateAccount(target, fields);
          break;
        }
        case "append_note": {
          const target = String(resolve(op.account_id, refs));
          const current = String((await crm.getAccount(target)).note ?? "").trim();
          const line = stamp(op.text);
          const note = current ? `${current}\n${line}` : line; // append, never overwrite
          res.response = await crm.updateAccount(target, { note });
          break;
        }
        case "move_contact": {
          res.response = await crm.updateContact(op.contact_id, { account_id: resolve(op.to_account_id, refs) });
          break;
        }
      }
      results.push(res);
      await store.update(id, { result: results, final_operations: ops });
      await store.addEvent(id, "op_applied", who, via, { op_id: op.id, describe: op.describe, created_id: res.created_id ?? null, adopted: res.adopted ?? false });
    } catch (e) {
      results.push({ op_id: op.id, ok: false, at: now(), actor: who, via, error: message(e) });
      const failed = await store.update(id, {
        status: "failed", result: results, final_operations: ops, ...decided,
        error: `Step "${op.describe}" failed: ${message(e)}. Finished steps are recorded; retrying resumes from this step.`,
      });
      await store.addEvent(id, "op_failed", who, via, { op_id: op.id, describe: op.describe, error: message(e) });
      await store.addEvent(id, "failed", who, via, { op_id: op.id, error: message(e) });
      return { case: failed, outcome: "failed" };
    }
  }

  const applied = await store.update(id, {
    status: "applied", result: results, final_operations: ops, error: null, decided_at: now(), ...decided,
  });
  await store.addEvent(id, "applied", who, via, { created: Object.fromEntries(Object.entries(refs)) });
  return { case: applied, outcome: "applied" };
}

async function move(deps: ExecDeps, id: number, from: CaseStatus[], to: CaseStatus, verb: string) {
  const c = await deps.store.transition(id, from, to);
  if (c) return c;
  const existing = await deps.store.get(id);
  if (!existing) throw new CaseNotFound(`Case ${id} not found`);
  throw new CaseConflict(`Case ${id} is ${existing.status}; it can't be ${verb}`);
}

export async function rejectCase(deps: ExecDeps, id: number, opts: { reason?: string | null; actor: Actor }) {
  await move(deps, id, ["pending", "stale", "failed"], "rejected", "rejected");
  const c = await deps.store.update(id, {
    decided_at: (deps.now?.() ?? new Date()).toISOString(), decided_by: opts.actor.name, decided_via: opts.actor.via,
    decision_note: opts.reason?.trim() || null,
  });
  await deps.store.addEvent(id, "rejected", opts.actor.name, opts.actor.via, { reason: opts.reason ?? null });
  return c;
}

/** Back to the queue. Only rejected or stale cases; never applied/applying. `result` is kept (it's history). */
export async function reopenCase(deps: ExecDeps, id: number, opts: { actor: Actor }) {
  await move(deps, id, ["rejected", "stale"], "pending", "reopened");
  const c = await deps.store.update(id, { decided_at: null, decided_by: null, decided_via: null, decision_note: null, error: null });
  await deps.store.addEvent(id, "reopened", opts.actor.name, opts.actor.via);
  return c;
}
