"""Review store (Supabase Postgres): runs, cases, and the audit trail.

The idempotency rules live in the pure function `plan_sync`, so they can be tested without a database:

    proposed case, fingerprint never seen         → INSERT as pending
    fingerprint seen, decided (applied/rejected)  → SKIP: a decided case is never re-proposed
    fingerprint seen, pending or stale            → REFRESH evidence from today's data (stale → pending again)
    fingerprint seen, superseded                  → REOPEN (the issue came back)
    fingerprint seen, applying or failed          → LEAVE for the reviewer (in-flight, or awaiting a retry)
    pending case NOT proposed this run            → SUPERSEDE (fixed outside the app, or the data changed)
"""
from __future__ import annotations

from dataclasses import dataclass, field

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

DECIDED = {"applied", "rejected"}
REFRESHABLE = {"pending", "stale"}
LEAVE = {"applying", "failed"}

# Columns the pipeline owns (rewritten on refresh). Decision/result columns belong to the review app.
CONTENT_COLUMNS = ("kind", "tags", "subject_key", "title", "summary", "reasoning", "location", "accounts",
                   "evidence", "sop", "confidence", "operations", "preconditions")
JSON_COLUMNS = {"reasoning", "location", "accounts", "evidence", "sop", "operations", "preconditions"}


@dataclass
class SyncPlan:
    insert: list[dict] = field(default_factory=list)
    refresh: list[tuple[int, dict, str]] = field(default_factory=list)  # (case id, case, previous status)
    reopen: list[tuple[int, dict]] = field(default_factory=list)
    skipped_decided: list[str] = field(default_factory=list)  # fingerprints
    left_alone: list[str] = field(default_factory=list)
    supersede: list[int] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {"new": len(self.insert), "refreshed": len(self.refresh), "reopened": len(self.reopen),
                "skipped_decided": len(self.skipped_decided), "left_alone": len(self.left_alone),
                "superseded": len(self.supersede)}


def plan_sync(existing: dict[str, tuple], proposed: list[dict], allow_supersede: bool = True) -> SyncPlan:
    """existing: fingerprint → (case id, status[, subject_key]) for every stored case. proposed: today's cases.

    A facility whose case is mid-apply or failed is "busy": no new proposal for it until that case is resolved,
    so a half-applied CHOW (new account created, link not yet written) can't spawn a bogus duplicate case."""
    plan = SyncPlan()
    seen: set[str] = set()
    busy = {v[2] for v in existing.values() if len(v) > 2 and v[1] in LEAVE}
    for case in proposed:
        fp = case["fingerprint"]
        if fp in seen:
            continue
        seen.add(fp)
        if fp not in existing:
            if case.get("subject_key") in busy:
                plan.left_alone.append(fp)
            else:
                plan.insert.append(case)
            continue
        case_id, status = existing[fp][:2]
        if status in DECIDED:
            plan.skipped_decided.append(fp)
        elif status in REFRESHABLE:
            plan.refresh.append((case_id, case, status))
        elif status == "superseded":
            plan.reopen.append((case_id, case))
        else:  # applying / failed
            plan.left_alone.append(fp)
    if allow_supersede:
        plan.supersede = sorted(v[0] for fp, v in existing.items() if v[1] == "pending" and fp not in seen)
    return plan


def _db_value(col: str, value):
    return Jsonb(value) if col in JSON_COLUMNS and value is not None else value


class Store:
    def __init__(self, database_url: str):
        if not database_url:
            raise ValueError("DATABASE_URL is not set (add it to .env)")
        self.conn = psycopg.connect(database_url, row_factory=dict_row, connect_timeout=20)

    def close(self) -> None:
        self.conn.close()

    # ---------- runs ----------
    def start_run(self, trigger: str) -> int:
        with self.conn.transaction():
            row = self.conn.execute("insert into runs (trigger) values (%s) returning id", (trigger,)).fetchone()
        return row["id"]

    def finish_run(self, run_id: int, *, status: str, summary: dict, scrape_snapshot, match_results,
                   location_count: int | None, account_count: int | None, error: str | None = None) -> None:
        with self.conn.transaction():
            self.conn.execute(
                """update runs set finished_at = now(), status = %s, summary = %s, scrape_snapshot = %s,
                   match_results = %s, location_count = %s, account_count = %s, error = %s where id = %s""",
                (status, Jsonb(summary), Jsonb(scrape_snapshot), Jsonb(match_results), location_count,
                 account_count, error, run_id))

    # ---------- cases ----------
    def existing_cases(self) -> dict[str, tuple[int, str, str]]:
        rows = self.conn.execute("select id, fingerprint, status, subject_key from cases").fetchall()
        return {r["fingerprint"]: (r["id"], r["status"], r["subject_key"]) for r in rows}

    def decided_cases(self) -> list[dict]:
        """Approved/rejected cases with their ORIGINAL proposed operations (feeds field-level decision memory)."""
        return self.conn.execute(
            "select subject_key, operations from cases where status in ('applied', 'rejected')").fetchall()

    def last_good_location_count(self) -> int | None:
        row = self.conn.execute(
            """select location_count from runs where status = 'succeeded' and location_count is not null
               and coalesce((summary -> 'scrape' ->> 'complete')::boolean, false) order by id desc limit 1""").fetchone()
        return row["location_count"] if row else None

    def sync_cases(self, run_id: int, proposed: list[dict], allow_supersede: bool = True) -> dict[str, int]:
        """Apply today's proposals idempotently, in one transaction. Returns counts for the run summary."""
        with self.conn.transaction():
            # Serialize concurrent pipeline runs (e.g. a manual run overlapping the daily schedule).
            self.conn.execute("select pg_advisory_xact_lock(hashtext('bellhaven-sync:cases'))")
            plan = plan_sync(self.existing_cases(), proposed, allow_supersede)
            for case in plan.insert:
                cols = ("fingerprint", *CONTENT_COLUMNS, "first_seen_run", "last_seen_run")
                vals = [case["fingerprint"], *(_db_value(c, case.get(c)) for c in CONTENT_COLUMNS), run_id, run_id]
                row = self.conn.execute(
                    f"insert into cases ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) returning id",
                    vals).fetchone()
                self._event(row["id"], "proposed", {"run_id": run_id})
            for case_id, case, prev in plan.refresh:
                self._rewrite(case_id, case, run_id, new_status="pending")
                self._event(case_id, "refreshed", {"run_id": run_id, "previous_status": prev})
            for case_id, case in plan.reopen:
                self._rewrite(case_id, case, run_id, new_status="pending")
                self._event(case_id, "reopened", {"run_id": run_id, "reason": "issue detected again"})
            for case_id in plan.supersede:
                self.conn.execute("update cases set status = 'superseded' where id = %s and status = 'pending'",
                                  (case_id,))
                self._event(case_id, "superseded", {"run_id": run_id, "reason": "no longer detected"})
        return plan.counts()

    def _rewrite(self, case_id: int, case: dict, run_id: int, new_status: str) -> None:
        sets = ", ".join(f"{c} = %s" for c in CONTENT_COLUMNS)
        self.conn.execute(
            f"update cases set {sets}, status = %s, last_seen_run = %s where id = %s",
            [*(_db_value(c, case.get(c)) for c in CONTENT_COLUMNS), new_status, run_id, case_id])

    def _event(self, case_id: int, event: str, detail: dict) -> None:
        self.conn.execute("insert into case_events (case_id, event, actor, via, detail) values (%s, %s, %s, %s, %s)",
                          (case_id, event, "pipeline", "pipeline", Jsonb(detail)))

    def status_counts(self) -> dict[str, int]:
        rows = self.conn.execute("select status, count(*) as n from cases group by status").fetchall()
        return {r["status"]: r["n"] for r in rows}
