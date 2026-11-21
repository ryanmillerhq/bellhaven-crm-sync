import "server-only";
/**
 * Service layer: the single entry point for reading and deciding cases. Used by the UI's server actions and by the
 * JSON API routes the MCP server calls, so both paths share the same executor, rules and audit trail.
 *
 * DATA_SOURCE=mock → in-memory store + fake CRM seeded from the real snapshot (no network writes at all).
 * otherwise        → Supabase Postgres (DATABASE_URL) + the real CRM API (CRM_API_TOKEN).
 */
import { HttpCrmClient } from "./crm";
import { PgCaseStore } from "./db";
import { approveCase, rejectCase, reopenCase, type ExecDeps } from "./executor";
import { buildMockCases, buildMockEvents, buildMockRuns, snapshotAccounts, snapshotContacts } from "./mock/cases";
import { FakeCrm } from "./mock/fake-crm";
import { computeProgress } from "./progress";
import { MemoryCaseStore, type CaseFilter } from "./store";
import type { Actor, Case, CaseEvent, CrmAccount, CrmContact, Edits, Progress, Run } from "./types";

export type DataMode = "mock" | "live";
export const dataMode = (): DataMode => (process.env.DATA_SOURCE === "mock" ? "mock" : "live");

const g = globalThis as unknown as { __mockDeps?: ExecDeps & { crm: FakeCrm }; __liveDeps?: ExecDeps };

export function deps(): ExecDeps {
  if (dataMode() === "mock") {
    if (!g.__mockDeps) {
      const cases = buildMockCases();
      g.__mockDeps = {
        store: new MemoryCaseStore(cases, buildMockRuns(cases), buildMockEvents(cases)),
        crm: new FakeCrm(snapshotAccounts(), snapshotContacts()),
      };
    }
    return g.__mockDeps;
  }
  if (!g.__liveDeps) {
    g.__liveDeps = {
      store: new PgCaseStore(),
      crm: new HttpCrmClient(process.env.CRM_BASE_URL ?? "https://analyst-assessment-production.up.railway.app/api/v1", process.env.CRM_API_TOKEN ?? ""),
    };
  }
  return g.__liveDeps;
}

/** Mock-only: the fake CRM, for the dev drift endpoint. */
export function mockCrm(): FakeCrm | null {
  return dataMode() === "mock" ? (deps() as ExecDeps & { crm: FakeCrm }).crm : null;
}

export const listCases = (filter?: CaseFilter) => deps().store.list(filter);

export async function getCase(id: number): Promise<(Case & { events: CaseEvent[] }) | null> {
  const c = await deps().store.get(id);
  return c ? { ...c, events: await deps().store.events(id) } : null;
}

export async function getProgress() {
  return computeProgress(await listCases());
}

export const getRuns = (limit = 10): Promise<Run[]> => deps().store.runs(limit);

export interface Dashboard { cases: Case[]; events: CaseEvent[]; progress: Progress; runs: Run[]; mode: DataMode }

export async function getDashboard(): Promise<Dashboard> {
  const [cases, runs] = await Promise.all([listCases(), getRuns(10)]);
  const events = await deps().store.eventsFor(cases.map((c) => c.id));
  return { cases, events, progress: computeProgress(cases), runs, mode: dataMode() };
}

export const approve = (id: number, opts: { edits?: Edits; note?: string | null; actor: Actor; expectedUpdatedAt?: string | null }) =>
  approveCase(deps(), id, opts);
export const reject = (id: number, opts: { reason?: string | null; actor: Actor }) => rejectCase(deps(), id, opts);
export const reopen = (id: number, opts: { actor: Actor }) => reopenCase(deps(), id, opts);

export const searchCrm = (q: string): Promise<CrmAccount[]> => deps().crm.searchAccounts(q);

export async function getCrmAccount(id: string): Promise<{ account: CrmAccount; contacts: CrmContact[] }> {
  const crm = deps().crm;
  const [account, contacts] = await Promise.all([crm.getAccount(id), crm.listContacts(id)]);
  return { account, contacts };
}
