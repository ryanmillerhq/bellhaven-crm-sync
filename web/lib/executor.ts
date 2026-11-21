/**
 * Generic case executor (docs/case-contract.md, "Executor rules").
 *
 * It contains no business rules. Matching, CHOW and duplicate decisions were made by the pipeline and are
 * expressed as an ordered list of operations. This module only:
 *   1. claims the case atomically (a double-click can't write twice),
 *   2. re-checks the CRM values the proposal assumed (drift → "stale", nothing written),
 *   3. runs the operations in order, resolving {$ref} ids and recording every result (resume-safe retries),
 *   4. records the outcome and an audit event.
 */
import type { CrmClient } from "./crm";
import type { CaseStore } from "./store";
import type { Actor, Case, CaseStatus, Edits, Operation, OperationResult, Precondition, Ref, Value } from "./types";

export interface ExecDeps { store: CaseStore; crm: CrmClient; now?: () => Date }

export class CaseNotFound extends Error {}
export class CaseConflict extends Error {}

export type Outcome = "applied" | "stale" | "failed";

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

export async function approveCase(
  deps: ExecDeps, id: number, opts: { edits?: Edits; note?: string | null; actor: Actor },
): Promise<{ case: Case; outcome: Outcome }> {
  const { store, crm } = deps;
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  const claimed = await store.transition(id, ["pending", "failed"], "applying");
  if (!claimed) {
    const existing = await store.get(id);
    if (!existing) throw new CaseNotFound(`Case ${id} not found`);
    throw new CaseConflict(`Case ${id} is ${existing.status}; only pending or failed cases can be approved`);
  }

  const prior = (claimed.result ?? []).filter((r) => r.ok);
  const isRetry = prior.length > 0;
  // A retry replays the operations exactly as first approved (edits included) so finished steps line up.
  const ops = isRetry && claimed.final_operations ? claimed.final_operations : applyEdits(claimed.operations, opts.edits);
  const decided = { decided_by: opts.actor.name, decided_via: opts.actor.via, decision_note: opts.note ?? claimed.decision_note ?? null };
  await store.addEvent(id, isRetry ? "retry" : "approved", opts.actor.name, opts.actor.via,
    { edits: opts.edits ?? {}, note: opts.note ?? null });

  // ids created by earlier successful steps (retries)
  const refs: Record<string, string> = {};
  for (const r of prior) {
    const op = ops.find((o) => o.id === r.op_id);
    if (op?.op === "create_account" && r.created_id) refs[op.ref] = r.created_id;
  }

  // ---- 2. preconditions (skip fields our own finished steps already changed) ----
  const touched = new Set<string>();
  for (const r of prior) {
    const op = ops.find((o) => o.id === r.op_id);
    if (op?.op === "update_account") {
      const acct = isRef(op.account_id) ? refs[op.account_id.$ref] : op.account_id;
      for (const f of Object.keys(op.fields)) touched.add(`${acct}:${f}`);
    }
    if (op?.op === "append_note") touched.add(`${isRef(op.account_id) ? refs[op.account_id.$ref] : op.account_id}:note`);
  }
  const drift: (Precondition & { actual: unknown })[] = [];
  const seen = new Map<string, Record<string, unknown>>();
  for (const p of claimed.preconditions) {
    if (touched.has(`${p.account_id}:${p.field}`)) continue;
    let acct = seen.get(p.account_id);
    if (!acct) {
      try {
        acct = (await crm.getAccount(p.account_id)) as Record<string, unknown>;
      } catch (e) {
        const failed = await store.update(id, { status: "failed", error: `Could not read account ${p.account_id} to re-check it: ${message(e)}`, final_operations: ops, ...decided });
        await store.addEvent(id, "failed", opts.actor.name, opts.actor.via, { stage: "preconditions", error: message(e) });
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
    await store.addEvent(id, "stale", opts.actor.name, opts.actor.via, { drift });
    return { case: stale, outcome: "stale" };
  }

  // ---- 3. run operations in order, persisting after each one ----
  const results: OperationResult[] = [...prior];
  for (const op of ops) {
    if (results.some((r) => r.op_id === op.id && r.ok)) continue;
    try {
      const res: OperationResult = { op_id: op.id, ok: true, at: now() };
      switch (op.op) {
        case "create_account": {
          const { id: created, response } = await crm.createAccount(resolveFields(op.fields, refs));
          refs[op.ref] = created;
          Object.assign(res, { created_id: created, response });
          break;
        }
        case "update_account": {
          const target = String(resolve(op.account_id, refs));
          res.response = await crm.updateAccount(target, resolveFields(op.fields, refs));
          break;
        }
        case "append_note": {
          const target = String(resolve(op.account_id, refs));
          const current = String((await crm.getAccount(target)).note ?? "").trim();
          const note = current ? `${current}\n${op.text}` : op.text; // append, never overwrite
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
    } catch (e) {
      results.push({ op_id: op.id, ok: false, at: now(), error: message(e) });
      const failed = await store.update(id, {
        status: "failed", result: results, final_operations: ops, ...decided,
        error: `Step "${op.describe}" failed: ${message(e)}. Finished steps are recorded; retrying resumes from this step.`,
      });
      await store.addEvent(id, "failed", opts.actor.name, opts.actor.via, { op_id: op.id, error: message(e) });
      return { case: failed, outcome: "failed" };
    }
  }

  const applied = await store.update(id, {
    status: "applied", result: results, final_operations: ops, error: null, decided_at: now(), ...decided,
  });
  await store.addEvent(id, "applied", opts.actor.name, opts.actor.via,
    { created: Object.fromEntries(Object.entries(refs)) });
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

export async function reopenCase(deps: ExecDeps, id: number, opts: { actor: Actor }) {
  await move(deps, id, ["rejected", "stale"], "pending", "reopened");
  const c = await deps.store.update(id, { decided_at: null, decided_by: null, decided_via: null, decision_note: null, error: null });
  await deps.store.addEvent(id, "reopened", opts.actor.name, opts.actor.via);
  return c;
}
