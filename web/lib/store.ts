import type { Case, CaseEvent, CaseKind, CaseStatus, Run } from "./types";

export interface CaseFilter { status?: CaseStatus | CaseStatus[]; kind?: CaseKind }
export interface ClaimOptions { leaseMs: number; expectedUpdatedAt?: string | null; now?: Date }

/** Same instant at millisecond precision (Postgres keeps microseconds; JS Dates and ISO strings keep milliseconds). */
export const sameInstant = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && Math.floor(new Date(a).getTime()) === Math.floor(new Date(b).getTime());

/** Persistence for cases, events and runs. Postgres in production, in-memory for mock mode and tests. */
export interface CaseStore {
  list(filter?: CaseFilter): Promise<Case[]>;
  get(id: number): Promise<Case | null>;
  /** Atomically move a case from one of `from` statuses to `to`. Returns the claimed case, or null if not claimable. */
  transition(id: number, from: CaseStatus[], to: CaseStatus): Promise<Case | null>;
  /**
   * Atomically claim a case for execution (status → 'applying') when it is pending/failed, OR stuck in 'applying'
   * longer than `leaseMs` (a serverless function died mid-run). With `expectedUpdatedAt`, the case must also be the
   * exact version the reviewer saw (compared at millisecond precision). Returns null when not claimable.
   */
  claim(id: number, opts: ClaimOptions): Promise<Case | null>;
  update(id: number, patch: Partial<Case>): Promise<Case>;
  addEvent(caseId: number, event: string, actor: string | null, via: string | null, detail?: unknown): Promise<void>;
  events(caseId: number): Promise<CaseEvent[]>;
  /** Audit events for many cases at once (dashboard timelines), oldest first. */
  eventsFor(caseIds: number[]): Promise<CaseEvent[]>;
  runs(limit?: number): Promise<Run[]>;
}

const clone = <T,>(v: T): T => structuredClone(v);

/** Single-process in-memory store. Transitions are check-and-set inside one synchronous block, so they're atomic. */
export class MemoryCaseStore implements CaseStore {
  private cases = new Map<number, Case>();
  private evts: CaseEvent[] = [];
  private runList: Run[];
  private nextEventId = 1;

  constructor(cases: Case[], runs: Run[] = [], seedEvents: Omit<CaseEvent, "id">[] = []) {
    for (const c of cases) this.cases.set(c.id, clone(c));
    this.runList = clone(runs);
    for (const e of seedEvents) this.evts.push({ ...clone(e), id: this.nextEventId++ });
  }

  async list(filter: CaseFilter = {}) {
    const statuses = filter.status ? ([] as CaseStatus[]).concat(filter.status) : null;
    return [...this.cases.values()]
      .filter((c) => c.status !== "superseded" || statuses?.includes("superseded"))
      .filter((c) => !statuses || statuses.includes(c.status))
      .filter((c) => !filter.kind || c.kind === filter.kind)
      .sort((a, b) => a.id - b.id)
      .map(clone);
  }

  async get(id: number) {
    const c = this.cases.get(id);
    return c ? clone(c) : null;
  }

  async transition(id: number, from: CaseStatus[], to: CaseStatus) {
    const c = this.cases.get(id);
    if (!c || !from.includes(c.status)) return null;
    c.status = to;
    c.updated_at = new Date().toISOString();
    return clone(c);
  }

  async claim(id: number, { leaseMs, expectedUpdatedAt, now = new Date() }: ClaimOptions) {
    const c = this.cases.get(id);
    if (!c) return null;
    const claimable = c.status === "pending" || c.status === "failed"
      || (c.status === "applying" && new Date(c.updated_at ?? 0).getTime() < now.getTime() - leaseMs);
    if (!claimable) return null;
    if (expectedUpdatedAt && !sameInstant(c.updated_at, expectedUpdatedAt)) return null;
    c.status = "applying";
    c.updated_at = new Date().toISOString();
    return clone(c);
  }

  async update(id: number, patch: Partial<Case>) {
    const c = this.cases.get(id);
    if (!c) throw new Error(`case ${id} not found`);
    Object.assign(c, clone(patch), { updated_at: new Date().toISOString() });
    return clone(c);
  }

  /** Test/mock hook: change a case as if the pipeline refreshed it (bumps updated_at, or sets it explicitly). */
  touch(id: number, patch: Partial<Case> = {}, updatedAt?: string) {
    const c = this.cases.get(id);
    if (c) Object.assign(c, clone(patch), { updated_at: updatedAt ?? new Date(Date.now() + 1).toISOString() });
  }

  async addEvent(caseId: number, event: string, actor: string | null, via: string | null, detail?: unknown) {
    this.evts.push({ id: this.nextEventId++, case_id: caseId, at: new Date().toISOString(), event, actor, via, detail: detail ?? null });
  }

  async events(caseId: number) {
    return this.evts.filter((e) => e.case_id === caseId).map(clone);
  }

  async eventsFor(caseIds: number[]) {
    const ids = new Set(caseIds);
    return this.evts.filter((e) => ids.has(e.case_id)).map(clone);
  }

  async runs(limit = 20) {
    return clone(this.runList.slice(0, limit));
  }
}
