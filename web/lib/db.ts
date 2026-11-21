import "server-only";
import { Pool } from "pg";
import type { CaseStore, CaseFilter, ClaimOptions } from "./store";
import type { Case, CaseEvent, CaseStatus, Run } from "./types";

// One small pool per server instance. On Vercel each function instance holds at most a couple of connections,
// which keeps us well inside the Supabase session pooler's limits.
//
// Transactions: every statement here is a single pool.query(), which autocommits and releases its client, so no
// connection is ever left mid-transaction. The claim is one conditional UPDATE ... RETURNING (atomic on its own).
// Claim + execute is intentionally NOT one DB transaction: it spans CRM HTTP calls, and holding a transaction (and a
// pooler connection) open across external I/O is worse than the status machine + per-op result log we use instead.
const g = globalThis as unknown as { __pgPool?: Pool };

function pool(): Pool {
  if (!g.__pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set (or use DATA_SOURCE=mock)");
    // Use Supabase's transaction pooler (port 6543): it multiplexes many short-lived clients, which is what
    // serverless needs. A frozen Vercel instance never runs idle timers, so keep each instance to one connection.
    // node-postgres never uses named prepared statements unless asked, so transaction mode is safe here.
    g.__pgPool = new Pool({
      connectionString,
      max: process.env.VERCEL ? 1 : 3,
      idleTimeoutMillis: 5_000,
      allowExitOnIdle: true,
      connectionTimeoutMillis: 10_000,
      ssl: { rejectUnauthorized: false }, // Supabase pooler terminates TLS with its own chain
    });
  }
  return g.__pgPool;
}

const JSON_COLUMNS = new Set([
  "reasoning", "location", "accounts", "evidence", "sop", "operations", "preconditions", "final_operations", "result",
]);
const WRITABLE = new Set([
  "status", "decided_at", "decided_by", "decided_via", "decision_note", "final_operations", "result", "error",
]);

export class PgCaseStore implements CaseStore {
  async list(filter: CaseFilter = {}): Promise<Case[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    const statuses = filter.status ? ([] as CaseStatus[]).concat(filter.status) : null;
    if (statuses) { args.push(statuses); where.push(`status = any($${args.length})`); }
    else where.push(`status <> 'superseded'`);
    if (filter.kind) { args.push(filter.kind); where.push(`kind = $${args.length}`); }
    const { rows } = await pool().query(`select * from public.cases where ${where.join(" and ")} order by id`, args);
    return rows.map(normalize);
  }

  async get(id: number) {
    const { rows } = await pool().query(`select * from public.cases where id = $1`, [id]);
    return rows[0] ? normalize(rows[0]) : null;
  }

  async transition(id: number, from: CaseStatus[], to: CaseStatus) {
    const { rows } = await pool().query(
      `update public.cases set status = $3 where id = $1 and status = any($2) returning *`, [id, from, to]);
    return rows[0] ? normalize(rows[0]) : null;
  }

  async claim(id: number, { leaseMs, expectedUpdatedAt }: ClaimOptions) {
    // One atomic statement: pending/failed, or an 'applying' lease that expired (dead function), and, when given,
    // exactly the version the reviewer saw. date_trunc: timestamptz has µs, the client's copy has ms.
    const { rows } = await pool().query(
      `update public.cases set status = 'applying'
         where id = $1
           and (status in ('pending', 'failed')
                or (status = 'applying' and updated_at < now() - make_interval(secs => $2::double precision)))
           and ($3::timestamptz is null or date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $3::timestamptz))
         returning *`,
      [id, leaseMs / 1000, expectedUpdatedAt ?? null]);
    return rows[0] ? normalize(rows[0]) : null;
  }

  async update(id: number, patch: Partial<Case>) {
    const sets: string[] = [];
    const args: unknown[] = [id];
    for (const [k, v] of Object.entries(patch)) {
      if (!WRITABLE.has(k)) continue;
      // jsonb values are always serialized explicitly: pg would turn JS arrays into Postgres arrays.
      args.push(JSON_COLUMNS.has(k) && v !== null ? JSON.stringify(v) : v);
      sets.push(`${k} = $${args.length}${JSON_COLUMNS.has(k) ? "::jsonb" : ""}`);
    }
    if (!sets.length) return (await this.get(id))!;
    const { rows } = await pool().query(`update public.cases set ${sets.join(", ")} where id = $1 returning *`, args);
    return normalize(rows[0]);
  }

  async addEvent(caseId: number, event: string, actor: string | null, via: string | null, detail?: unknown) {
    await pool().query(
      `insert into public.case_events (case_id, event, actor, via, detail) values ($1, $2, $3, $4, $5::jsonb)`,
      [caseId, event, actor, via, detail === undefined ? null : JSON.stringify(detail)]);
  }

  async events(caseId: number): Promise<CaseEvent[]> {
    const { rows } = await pool().query(`select * from public.case_events where case_id = $1 order by at, id`, [caseId]);
    return rows.map((r) => ({ ...r, id: Number(r.id), case_id: Number(r.case_id), at: iso(r.at) }));
  }

  async eventsFor(caseIds: number[]): Promise<CaseEvent[]> {
    if (!caseIds.length) return [];
    const { rows } = await pool().query(
      `select * from public.case_events where case_id = any($1) order by at, id`, [caseIds]);
    return rows.map((r) => ({ ...r, id: Number(r.id), case_id: Number(r.case_id), at: iso(r.at) }));
  }

  async runs(limit = 20): Promise<Run[]> {
    const { rows } = await pool().query(
      `select id, started_at, finished_at, trigger, status, location_count, account_count, summary, match_results, error
         from public.runs order by id desc limit $1`, [limit]);
    return rows.map((r) => ({ ...r, id: Number(r.id), started_at: iso(r.started_at), finished_at: iso(r.finished_at) }));
  }
}

function iso(v: unknown): string | null {
  return v instanceof Date ? v.toISOString() : (v as string | null);
}

function normalize(r: Record<string, unknown>): Case {
  return {
    ...(r as unknown as Case),
    id: Number(r.id),
    first_seen_run: r.first_seen_run == null ? null : Number(r.first_seen_run),
    last_seen_run: r.last_seen_run == null ? null : Number(r.last_seen_run),
    decided_at: iso(r.decided_at),
    created_at: iso(r.created_at) ?? undefined,
    updated_at: iso(r.updated_at) ?? undefined,
  };
}
