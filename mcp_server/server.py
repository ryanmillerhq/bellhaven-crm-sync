"""FastMCP server: Claude works the Bellhaven review queue through the review app's own HTTP API.

There are no logic forks here. Reads and writes go to the review app (web/app/api/**), so an approval made from
Claude runs the same executor as a click in the UI: atomic claim, live precondition re-check, CHOW/duplicate
sequencing, and an audit trail stamped with REVIEWER and "via mcp".
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import anyio
import httpx
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations

from .client import ReviewApp, ReviewAppError, Settings
from .formatting import (format_account, format_accounts, format_case, format_case_list, format_progress,
                         format_results, format_runs)

REPO_ROOT = Path(__file__).resolve().parents[1]
PIPELINE_TIMEOUT_S = 15 * 60
CASE_STATUSES = ("pending", "applying", "applied", "rejected", "failed", "stale", "superseded")
CASE_KINDS = ("chow", "reparent", "duplicate", "rename", "field_fix", "create", "sold", "unlisted", "reactivate")

# Test hook: an httpx transport (e.g. httpx.MockTransport) used instead of the network.
_transport: httpx.AsyncBaseTransport | None = None

INSTRUCTIONS = """\
Bellhaven CRM Sync review queue. Each case is one proposed CRM change for one facility (CHOW, re-parent,
duplicate, rename, field fix, create, sold, unlisted), with the pipeline's reasoning and website-vs-CRM evidence.

Workflow: get_progress or list_cases → get_case(id) → explain the reasoning, evidence, SOP check and planned steps
to the human → only when the human explicitly confirms a decision on that specific case, call approve_case,
reject_case or reopen_case. Never decide cases on your own initiative, and never batch decisions the human has
not confirmed one by one.

approve_case writes to the REAL CRM. Every write goes through the review app's executor (same CHOW/duplicate
logic, preconditions and audit trail as the UI, recorded as "via mcp"); nothing here writes to the CRM directly.
"""

mcp = FastMCP("bellhaven-review", instructions=INSTRUCTIONS)

READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)


def _reader() -> ReviewApp:
    return ReviewApp(Settings.from_env(), transport=_transport)


def _writer() -> ReviewApp:
    settings = Settings.from_env()
    if not settings.reviewer:
        raise ToolError(
            "Refusing to write: REVIEWER is not set. Set it in the MCP server's env (see .mcp.json), e.g. "
            "REVIEWER=\"Ryan Miller (via Claude MCP)\", so the audit trail records who made the decision. "
            "Nothing was sent to the review app."
        )
    return ReviewApp(settings, transport=_transport)


def _write_error(e: ReviewAppError, case_id: int, verb: str) -> ToolError:
    """Turn a review-app error on a write into a message that says plainly what happened and what to do."""
    msg = str(e)
    if e.status == 409 and e.code == "refreshed":
        return ToolError(
            f"NOT {verb.upper()}: case #{case_id} changed after it was read (e.g. a pipeline run refreshed it). "
            f"Nothing was written. Call get_case({case_id}) again, show the human what changed, and only retry "
            f"after they confirm again. Review app said: {msg}"
        )
    if e.status == 409:
        return ToolError(f"NOT {verb.upper()}: {msg}. Nothing was written. Check get_case({case_id}) for its current status.")
    if e.status == 401:
        return ToolError(f"NOT {verb.upper()}: the review app requires a passcode for writes. Set REVIEW_PASSCODE in the "
                         f"MCP server's env. Review app said: {msg}")
    return ToolError(f"NOT {verb.upper()}: {msg}")


def _clean_edits(case: dict[str, Any], edits: dict[str, Any] | None) -> dict[str, dict[str, str]]:
    """Check edits against each step's editable fields (the executor silently ignores others) and stringify values."""
    if not edits:
        return {}
    ops = {op.get("id"): op for op in case.get("operations") or []}
    out: dict[str, dict[str, str]] = {}
    problems: list[str] = []
    for op_id, fields in edits.items():
        op = ops.get(op_id)
        if op is None:
            problems.append(f'no step "{op_id}" in case #{case.get("id")} (steps: {", ".join(map(str, ops)) or "none"})')
            continue
        if not isinstance(fields, dict):
            problems.append(f'edits for "{op_id}" must be an object of field → value')
            continue
        editable = op.get("editable") or []
        for field, value in fields.items():
            if field not in editable:
                problems.append(f'"{op_id}.{field}" is not editable (editable on {op_id}: {", ".join(editable) or "none"})')
            elif isinstance(value, (dict, list)):
                problems.append(f'"{op_id}.{field}" must be a plain value')
            else:
                out.setdefault(op_id, {})[field] = "" if value is None else str(value)
    if problems:
        raise ToolError("Nothing was sent. Fix these edits: " + "; ".join(problems))
    return out


# ---------------------------------------------------------------------------------------------- read tools

@mcp.tool(annotations=READ, structured_output=False)
async def get_progress() -> str:
    """Review progress: how many cases are decided, pending, applied, rejected or need attention, overall and per kind. Read-only."""
    return format_progress(await _reader().progress())


@mcp.tool(annotations=READ, structured_output=False)
async def list_cases(status: str = "pending", kind: str | None = None) -> str:
    """List review cases as compact rows (id, kind, tags, title, confidence, summary). Read-only.

    status: one of pending, applying, applied, rejected, failed, stale, superseded; several comma-separated
            (e.g. "failed,stale"); or "all" (everything except superseded).
    kind:   optional filter: chow, reparent, duplicate, rename, field_fix, create, sold, unlisted, reactivate.
    """
    status = (status or "").strip().lower()
    status_param = None if status in ("", "all", "any") else ",".join(s.strip() for s in status.split(",") if s.strip())
    bad = [s for s in (status_param or "").split(",") if s and s not in CASE_STATUSES]
    if bad:
        raise ToolError(f"Unknown status {', '.join(bad)}. Use one of: {', '.join(CASE_STATUSES)}, or 'all'.")
    kind = (kind or "").strip().lower() or None
    if kind and kind not in CASE_KINDS:
        raise ToolError(f"Unknown kind {kind!r}. Use one of: {', '.join(CASE_KINDS)}.")
    cases = await _reader().cases(status=status_param, kind=kind)
    return format_case_list(cases, status=status_param, kind=kind)


@mcp.tool(annotations=READ, structured_output=False)
async def get_case(case_id: int) -> str:
    """One case in full, for deciding it: pipeline reasoning, website record, CRM accounts, website-vs-CRM evidence
    table, CHOW SOP check, the planned steps approve_case would run (with editable fields), the preconditions
    re-checked before writing, and the audit trail. Read-only.
    """
    return format_case(await _reader().case(case_id))


@mcp.tool(annotations=READ, structured_output=False)
async def search_crm(q: str) -> str:
    """Search CRM accounts by name, city, street, zip or id (proxied by the review app; the CRM token never leaves it). Read-only."""
    q = (q or "").strip()[:100]
    return format_accounts(await _reader().search_accounts(q), q)


@mcp.tool(annotations=READ, structured_output=False)
async def get_account(account_id: str) -> str:
    """One CRM account as it is right now (live read), with its full note and contacts. Read-only."""
    return format_account(await _reader().account(account_id))


@mcp.tool(annotations=READ, structured_output=False)
async def list_runs(limit: int = 5) -> str:
    """Recent pipeline runs: when, trigger, scrape completeness, cases found, queue changes, warnings and errors. Read-only."""
    return format_runs(await _reader().runs(max(1, min(int(limit), 50))))


# ---------------------------------------------------------------------------------------------- write tools

@mcp.tool(
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=True),
    structured_output=False,
)
async def approve_case(
    case_id: int, edits: dict[str, dict[str, Any]] | None = None, note: str | None = None,
    expected_updated_at: str | None = None,
) -> str:
    """APPROVE a case. THIS WRITES TO THE REAL CRM (creates/updates accounts, appends notes, moves contacts).

    Only call this after the human has explicitly confirmed approving THIS case in the conversation, having seen
    its evidence and planned steps (get_case). Never approve on your own initiative or in bulk.

    The write goes through the review app's executor, exactly like the UI's Approve button: the CRM values the
    proposal assumed are re-checked first (any drift → the case goes stale and nothing is written), then the
    planned steps run in order with the same CHOW/duplicate logic, and the audit trail records REVIEWER via mcp.

    edits: optional changes to editable fields only, keyed by step id, e.g. {"op23": {"name": "Bellhaven of Tiffin"}}.
    note:  optional decision note for the audit trail.
    expected_updated_at: the case's updated_at the human reviewed (shown by get_case). If omitted, the case is
           fetched now and its current updated_at is sent. Either way a case refreshed in between is refused (409).
    """
    app = _writer()
    try:
        case = await app.case(case_id)
        clean = _clean_edits(case, edits)
        status, data = await app.approve(case_id, edits=clean, note=(note or "").strip() or None,
                                         expected_updated_at=expected_updated_at or case.get("updated_at"))
    except ReviewAppError as e:
        raise _write_error(e, case_id, "approved") from e

    c = data.get("case") or {}
    outcome = data.get("outcome")
    title = c.get("title") or case.get("title")
    steps = format_results(c)
    if status == 200 and outcome == "applied":
        return "\n".join([f"APPLIED case #{case_id} “{title}”: recorded as {c.get('decided_by')} via {c.get('decided_via')}.",
                          "Steps:", *steps, f"Case status now: {c.get('status')}."])
    if outcome == "stale":
        raise ToolError(f"NOT APPLIED: case #{case_id} “{title}” went stale. {c.get('error') or ''} "
                        "Nothing was written to the CRM.".strip())
    raise ToolError("\n".join([
        f"FAILED: case #{case_id} “{title}” stopped partway ({outcome}). {c.get('error') or ''}".strip(),
        "Steps so far:", *(steps or ["- none"]),
        "Finished steps are recorded; approving again (after the human confirms) resumes from the failed step.",
    ]))


@mcp.tool(
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False),
    structured_output=False,
)
async def reject_case(case_id: int, reason: str) -> str:
    """REJECT a case. This records a decision in the REAL review queue: the CRM itself is not touched, but this exact
    change will not be proposed again by later pipeline runs.

    Only call this after the human has explicitly confirmed rejecting THIS case in the conversation. Goes through the
    review app (audit trail records REVIEWER via mcp). reason: why, in a sentence, for the audit trail.
    """
    app = _writer()
    try:
        c = await app.reject(case_id, (reason or "").strip() or None)
    except ReviewAppError as e:
        raise _write_error(e, case_id, "rejected") from e
    return (f"REJECTED case #{case_id} “{c.get('title')}”: recorded as {c.get('decided_by')} via {c.get('decided_via')}"
            f"{', reason: ' + c['decision_note'] if c.get('decision_note') else ''}. Nothing was written to the CRM; "
            "this change will not be proposed again.")


@mcp.tool(
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False),
    structured_output=False,
)
async def reopen_case(case_id: int) -> str:
    """REOPEN a rejected or stale case: puts it back in the REAL review queue as pending (its history is kept).
    The CRM is not touched, but the case becomes approvable again (and approval writes to the real CRM).

    Only call this after the human has explicitly confirmed reopening THIS case. Goes through the review app
    (audit trail records REVIEWER via mcp).
    """
    app = _writer()
    try:
        c = await app.reopen(case_id)
    except ReviewAppError as e:
        raise _write_error(e, case_id, "reopened") from e
    return f"REOPENED case #{case_id} “{c.get('title')}”: status is now {c.get('status')}."


# ---------------------------------------------------------------------------------------------- pipeline

def _pipeline_python() -> str:
    for rel in (".venv/Scripts/python.exe", ".venv/bin/python"):
        if (REPO_ROOT / rel).exists():
            return str(REPO_ROOT / rel)
    return sys.executable


_SECRET_PATTERNS = [
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+"), r"\1[redacted]"),
    (re.compile(r"/crm/[^/\s]+/"), "/crm/[redacted]/"),
    (re.compile(r"://[^/\s:@]+:[^@\s]+@"), "://[redacted]@"),
]


def _redact(text: str) -> str:
    for pattern, repl in _SECRET_PATTERNS:
        text = pattern.sub(repl, text)
    return text


@mcp.tool(
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=True),
    structured_output=False,
)
async def run_pipeline(dry_run: bool = True) -> str:
    """Run the sync pipeline (scrape the website, read the CRM read-only, match, build cases) and return its summary.

    dry_run=True (default): prints the cases it would queue and saves nothing.
    dry_run=False: saves the run and its cases to the REAL review queue (new cases appear, changed ones refresh).
    It never writes to the CRM, but only use dry_run=False after the human explicitly confirms it.
    Takes a minute or two (it drives a headless browser).
    """
    cmd = [_pipeline_python(), "-m", "pipeline", "run"] + (["--dry-run"] if dry_run else [])
    shown = "python -m pipeline run" + (" --dry-run" if dry_run else "")

    def run() -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            cmd, cwd=REPO_ROOT, stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=PIPELINE_TIMEOUT_S, env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

    try:
        proc = await anyio.to_thread.run_sync(run)
    except subprocess.TimeoutExpired as e:
        raise ToolError(f"`{shown}` did not finish within {PIPELINE_TIMEOUT_S // 60} minutes and was stopped.") from e
    except OSError as e:
        raise ToolError(f"Could not start `{shown}` with {cmd[0]}: {e}") from e

    out = [line.rstrip() for line in _redact(proc.stdout or "").splitlines()]
    while out and not out[0]:
        out.pop(0)
    if proc.returncode != 0:
        err = _redact(proc.stderr or "").strip().splitlines()[-25:]
        raise ToolError("\n".join([f"`{shown}` failed (exit {proc.returncode}).", *out[-40:], "stderr (last lines):", *err]))
    return "\n".join([f"`{shown}` finished (exit 0) in {REPO_ROOT.name}:", "", *out[-150:]])


def main() -> None:
    mcp.run()  # stdio


if __name__ == "__main__":
    main()
