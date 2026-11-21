"""MCP server tests. No network: the review app is an httpx.MockTransport, the pipeline a fake subprocess.run."""
from __future__ import annotations

import asyncio
import copy
import json
import subprocess

import httpx
import pytest
from mcp.server.fastmcp.exceptions import ToolError

from mcp_server import server
from mcp_server.client import ReviewAppError

UPDATED_AT = "2026-11-21T20:05:01.553Z"

# Trimmed from the real Tiffin CHOW case (GET /api/cases/79).
CASE = {
    "id": 79, "kind": "chow", "tags": ["chow"], "status": "pending", "confidence": "high",
    "subject_key": "site:bellhaven-of-tiffin", "title": "Bellhaven of Tiffin",
    "summary": "Change of ownership: still under Cedar Trail Communities with open AR (SOP: new account + link)",
    "reasoning": ["Matched to CRM account “Bellhaven of Tiffin” (001U6RW32TY0WSXZZB) on address + name."],
    "location": {"name": "Bellhaven of Tiffin", "street": "45 St Lawrence Dr", "city": "Tiffin", "state": "OH",
                 "zip": "44883", "care_offerings": ["Short-Term Rehabilitation & Nursing"],
                 "administrator": "Walt Osei", "phone": "(260) 589-2589", "found_on": ["directory p2"],
                 "url": "https://example.test/communities/bellhaven-of-tiffin", "slug": "bellhaven-of-tiffin"},
    "accounts": [{
        "role": "old_record", "match_signals": ["address", "name"], "contacts": [],
        "account": {"account_id": "001U6RW32TY0WSXZZB", "name": "Bellhaven of Tiffin",
                    "parent_id": "001FWSQ30SFW6S7604", "parent_name": "Cedar Trail Communities (Parent Account)",
                    "billing_street": "45 St Lawrence Dr", "billing_city": "Tiffin", "billing_state": "OH",
                    "billing_zip": "44883", "care_type": "Skilled Nursing", "status": "Active",
                    "lifetime_revenue": 84000, "outstanding_ar": 12400, "duplicate_of_account": "",
                    "chow_current_account": "", "note": ""},
    }],
    "evidence": [
        {"field": "parent", "label": "Parent company", "website": "Bellhaven Senior Living",
         "crm": "Cedar Trail Communities", "match": "different", "account_id": "001U6RW32TY0WSXZZB"},
        {"field": "phone", "label": "Phone", "website": "(260) 589-2589", "crm": "(614) 829-9278",
         "match": "different", "note": "Evidence only (phone is not synced)", "account_id": "001U6RW32TY0WSXZZB"},
    ],
    "sop": {"account_id": "001U6RW32TY0WSXZZB", "lifetime_revenue": 84000, "outstanding_ar": 12400,
            "from_parent": "Cedar Trail Communities", "to_parent": "Bellhaven Senior Living", "branch": "chow",
            "explanation": "Billing history ($84,000) AND open AR ($12,400)."},
    "operations": [
        {"id": "op23", "op": "create_account", "ref": "new",
         "fields": {"name": "Bellhaven of Tiffin", "parent_id": "0015QAPLGS3FVYEEEM", "billing_zip": "44883"},
         "editable": ["name", "billing_zip"], "describe": "Create “Bellhaven of Tiffin” under Bellhaven Senior Living"},
        {"id": "op24", "op": "update_account", "account_id": "001U6RW32TY0WSXZZB",
         "fields": {"chow_current_account": {"$ref": "new"}}, "editable": [],
         "describe": "Point the old Cedar Trail Communities account to the new one"},
    ],
    "preconditions": [{"account_id": "001U6RW32TY0WSXZZB", "field": "outstanding_ar", "equals": 12400}],
    "first_seen_run": 5, "last_seen_run": 5, "decided_at": None, "decided_by": None, "decided_via": None,
    "decision_note": None, "final_operations": None, "result": None, "error": None, "updated_at": UPDATED_AT,
    "events": [{"id": 105, "case_id": 79, "at": UPDATED_AT, "event": "proposed", "actor": "pipeline",
                "via": "pipeline", "detail": {"run_id": 5}}],
}


def run(coro):
    return asyncio.run(coro)


class FakeReviewApp:
    """Stands in for the review app: canned responses per (method, path), every request recorded."""

    def __init__(self):
        self.routes: dict[tuple[str, str], object] = {}
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        route = self.routes.get((request.method, request.url.path))
        if route is None:
            return httpx.Response(404, json={"error": f"no route for {request.method} {request.url.path}"})
        status, body = route(request) if callable(route) else route
        return httpx.Response(status, json=body)

    def posts(self) -> list[httpx.Request]:
        return [r for r in self.requests if r.method == "POST"]


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("REVIEW_APP_URL", "http://review.test")
    monkeypatch.setenv("REVIEWER", "Test Reviewer (via Claude MCP)")
    monkeypatch.delenv("REVIEW_PASSCODE", raising=False)
    fake = FakeReviewApp()
    monkeypatch.setattr(server, "_transport", httpx.MockTransport(fake))
    return fake


def applied_case(**changes):
    c = copy.deepcopy(CASE)
    c.update(status="applied", decided_by="Test Reviewer (via Claude MCP)", decided_via="mcp",
             result=[{"op_id": "op23", "ok": True, "created_id": "001NEWTIFFIN00001", "actor": "x", "via": "mcp", "at": "t"},
                     {"op_id": "op24", "ok": True, "actor": "x", "via": "mcp", "at": "t"}], **changes)
    return c


# ---------------------------------------------------------------------------------------------- reads

def test_list_cases_returns_compact_rows(app):
    other = {**CASE, "id": 81, "kind": "create", "tags": ["create"], "title": "Bellhaven of Batavia", "confidence": "medium",
             "summary": "Missing from the CRM | new community"}
    app.routes[("GET", "/api/cases")] = (200, {"cases": [CASE, other], "count": 2})

    out = run(server.list_cases())

    assert app.requests[0].url.params["status"] == "pending"
    assert "2 cases (status=pending)" in out
    assert "| id | kind | tags | title | confidence | summary |" in out
    assert "| 79 | chow | chow | Bellhaven of Tiffin | high | Change of ownership" in out
    assert "| 81 | create | create | Bellhaven of Batavia | medium | Missing from the CRM / new community |" in out
    assert "Matched to CRM account" not in out  # reasoning/evidence stay in get_case


def test_list_cases_filters_and_validates(app):
    app.routes[("GET", "/api/cases")] = (200, {"cases": [], "count": 0})

    out = run(server.list_cases(status="all", kind="chow"))
    params = app.requests[0].url.params
    assert "status" not in params and params["kind"] == "chow"
    assert out.startswith("No cases match")

    with pytest.raises(ToolError, match="Unknown status"):
        run(server.list_cases(status="pending,bogus"))
    assert len(app.requests) == 1


def test_get_case_is_formatted_for_reasoning(app):
    app.routes[("GET", "/api/cases/79")] = (200, {"case": CASE})

    out = run(server.get_case(79))

    assert out.startswith("# Case #79: Bellhaven of Tiffin")
    assert f"updated_at {UPDATED_AT}" in out
    assert "## What we found (pipeline reasoning)\n- Matched to CRM account" in out
    assert "45 St Lawrence Dr, Tiffin, OH 44883" in out
    assert "lifetime revenue $84,000 · outstanding AR $12,400" in out
    assert "| Parent company | Bellhaven Senior Living | Cedar Trail Communities | different | - |" in out
    assert "| Phone | (260) 589-2589 | (614) 829-9278 | different | Evidence only (phone is not synced) |" in out
    assert "Branch: chow" in out
    assert "1. [op23] Create “Bellhaven of Tiffin” under Bellhaven Senior Living" in out
    assert '- name = "Bellhaven of Tiffin"  (editable)' in out
    assert '- parent_id = "0015QAPLGS3FVYEEEM"\n' in out  # not editable: no marker
    assert "editable fields: name, billing_zip" in out
    assert "update_account on 001U6RW32TY0WSXZZB (“Bellhaven of Tiffin”, old_record)" in out
    assert "- chow_current_account = <id of the account created by step op23>" in out
    assert "outstanding_ar must still be 12400" in out
    assert f"- {UPDATED_AT} · proposed · pipeline via pipeline · " + '{"run_id": 5}' in out


def test_get_progress_and_runs(app):
    app.routes[("GET", "/api/progress")] = (200, {"progress": {
        "total": 26, "decided": 3, "pending": 23, "applied": 2, "rejected": 1, "attention": 0,
        "byKind": {"chow": {"total": 2, "decided": 1}, "rename": {"total": 7, "decided": 2}}}})
    app.routes[("GET", "/api/runs")] = (200, {"runs": [{
        "id": 5, "trigger": "manual", "status": "succeeded", "started_at": "s", "finished_at": "f",
        "location_count": 35, "account_count": 121, "error": None, "match_results": [{}] * 38,
        "summary": {"scrape": {"found_count": 35, "claimed_count": 35, "complete": True,
                               "warnings": ["1 community is linked only from the homepage"], "failed": []},
                    "case_count": 26, "cases_by_kind": {"chow": 2, "rename": 7}, "in_sync": 13,
                    "store": {"new": 6, "refreshed": 20, "superseded": 0}}}]})

    progress = run(server.get_progress())
    assert "3 of 26 cases decided (12%)" in progress
    assert "- rename: 2 / 7" in progress

    runs = run(server.list_runs(limit=2))
    assert app.requests[-1].url.params["limit"] == "2"
    assert "#5 manual · succeeded" in runs and "26 cases (chow 2, rename 7)" in runs
    assert "queue changes: new 6, refreshed 20" in runs
    assert "warning: 1 community is linked only from the homepage" in runs


def test_tools_are_callable_through_fastmcp(app):
    app.routes[("GET", "/api/cases")] = (200, {"cases": [CASE], "count": 1})

    result = run(server.mcp.call_tool("list_cases", {"status": "pending"}))
    content = result[0] if isinstance(result, tuple) else result

    assert "| 79 | chow |" in content[0].text


def test_unreachable_app_says_so(monkeypatch):
    monkeypatch.setenv("REVIEW_APP_URL", "http://review.test")

    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)

    monkeypatch.setattr(server, "_transport", httpx.MockTransport(refuse))
    with pytest.raises(ReviewAppError, match="Could not reach the review app at http://review.test"):
        run(server.get_progress())


# ---------------------------------------------------------------------------------------------- writes

def test_approve_sends_expected_updated_at_and_reviewer(app, monkeypatch):
    monkeypatch.setenv("REVIEW_PASSCODE", "test-passcode")
    app.routes[("GET", "/api/cases/79")] = (200, {"case": CASE})
    app.routes[("POST", "/api/cases/79/approve")] = (200, {"outcome": "applied", "case": applied_case()})

    out = run(server.approve_case(79, edits={"op23": {"name": "Bellhaven of Tiffin OH", "billing_zip": 44883}},
                                  note="Confirmed by Ryan in chat"))

    get, post = app.requests  # fetched first, then approved
    assert get.method == "GET" and get.url.path == "/api/cases/79"
    assert json.loads(post.content) == {
        "edits": {"op23": {"name": "Bellhaven of Tiffin OH", "billing_zip": "44883"}},  # values sent as strings
        "expected_updated_at": UPDATED_AT,
        "note": "Confirmed by Ryan in chat",
    }
    assert post.headers["x-reviewer"] == "Test Reviewer (via Claude MCP)"
    assert post.headers["x-review-passcode"] == "test-passcode"
    assert "x-reviewer" not in get.headers  # reads don't claim an identity
    assert out.startswith("APPLIED case #79 “Bellhaven of Tiffin”: recorded as Test Reviewer (via Claude MCP) via mcp.")
    assert "op23 ok: Create “Bellhaven of Tiffin” under Bellhaven Senior Living → created 001NEWTIFFIN00001" in out


def test_approve_sends_the_version_the_human_reviewed(app):
    app.routes[("GET", "/api/cases/79")] = (200, {"case": {**CASE, "updated_at": "2026-11-22T06:00:00.000Z"}})
    app.routes[("POST", "/api/cases/79/approve")] = (200, {"outcome": "applied", "case": applied_case()})

    run(server.approve_case(79, expected_updated_at=UPDATED_AT))

    body = json.loads(app.posts()[0].content)
    assert body["expected_updated_at"] == UPDATED_AT and body["edits"] == {} and "note" not in body
    assert "x-review-passcode" not in app.posts()[0].headers


def test_writes_refuse_without_reviewer(app, monkeypatch):
    monkeypatch.delenv("REVIEWER")
    for call in (server.approve_case(79), server.reject_case(79, "wrong match"), server.reopen_case(79)):
        with pytest.raises(ToolError, match="REVIEWER is not set"):
            run(call)
    assert app.requests == []  # refused before anything was sent


def test_approve_surfaces_409_refreshed(app):
    app.routes[("GET", "/api/cases/79")] = (200, {"case": CASE})
    app.routes[("POST", "/api/cases/79/approve")] = (409, {
        "error": "Case 79 was refreshed after you opened it (e.g. by the daily pipeline run); please re-review it before approving.",
        "code": "refreshed"})

    with pytest.raises(ToolError) as exc:
        run(server.approve_case(79))

    msg = str(exc.value)
    assert msg.startswith("NOT APPROVED: case #79 changed after it was read")
    assert "Nothing was written" in msg and "Call get_case(79) again" in msg
    assert "please re-review it before approving. (HTTP 409)" in msg


def test_approve_surfaces_409_conflict(app):
    app.routes[("GET", "/api/cases/79")] = (200, {"case": {**CASE, "status": "applied"}})
    app.routes[("POST", "/api/cases/79/approve")] = (409, {
        "error": "Case 79 is applied; only pending or failed cases can be approved", "code": "conflict"})

    with pytest.raises(ToolError, match=r"NOT APPROVED: Case 79 is applied; only pending or failed cases can be approved \(HTTP 409\)"):
        run(server.approve_case(79))


def test_approve_surfaces_422_stale(app):
    stale = {**CASE, "status": "stale", "error": "The CRM changed since this case was proposed: outstanding_ar on 001U6RW32TY0WSXZZB."}
    app.routes[("GET", "/api/cases/79")] = (200, {"case": CASE})
    app.routes[("POST", "/api/cases/79/approve")] = (422, {"outcome": "stale", "case": stale})

    with pytest.raises(ToolError) as exc:
        run(server.approve_case(79))

    msg = str(exc.value)
    assert msg.startswith("NOT APPLIED: case #79 “Bellhaven of Tiffin” went stale.")
    assert "outstanding_ar on 001U6RW32TY0WSXZZB" in msg and "Nothing was written to the CRM." in msg


def test_approve_refuses_edits_to_non_editable_fields(app):
    app.routes[("GET", "/api/cases/79")] = (200, {"case": CASE})

    with pytest.raises(ToolError, match=r'"op24.chow_current_account" is not editable .*; no step "op99"'):
        run(server.approve_case(79, edits={"op24": {"chow_current_account": "001X"}, "op99": {"name": "x"}}))
    assert app.posts() == []  # the executor would silently ignore it, so nothing is sent


def test_reject_and_reopen_send_reviewer(app):
    rejected = {**CASE, "status": "rejected", "decided_by": "Test Reviewer (via Claude MCP)", "decided_via": "mcp",
                "decision_note": "Not our facility"}
    app.routes[("POST", "/api/cases/79/reject")] = (200, {"case": rejected})
    app.routes[("POST", "/api/cases/79/reopen")] = (200, {"case": {**CASE, "status": "pending"}})

    out = run(server.reject_case(79, " Not our facility "))
    post = app.posts()[0]
    assert json.loads(post.content) == {"reason": "Not our facility"}
    assert post.headers["x-reviewer"] == "Test Reviewer (via Claude MCP)"
    assert "REJECTED case #79" in out and "reason: Not our facility" in out and "Nothing was written to the CRM" in out

    out = run(server.reopen_case(79))
    assert app.posts()[1].headers["x-reviewer"] == "Test Reviewer (via Claude MCP)"
    assert out == "REOPENED case #79 “Bellhaven of Tiffin”: status is now pending."


def test_reject_surfaces_conflict(app):
    app.routes[("POST", "/api/cases/79/reject")] = (409, {"error": "Case 79 is applied; it can't be rejected", "code": "conflict"})
    with pytest.raises(ToolError, match="NOT REJECTED: Case 79 is applied; it can't be rejected"):
        run(server.reject_case(79, "changed my mind"))


def test_tool_descriptions_and_hints():
    tools = {t.name: t for t in run(server.mcp.list_tools())}

    assert "THIS WRITES TO THE REAL CRM" in tools["approve_case"].description
    for name in ("approve_case", "reject_case", "reopen_case"):
        desc = tools[name].description
        assert "REAL" in desc and "explicitly confirmed" in desc, name
        assert tools[name].annotations.readOnlyHint is False
    assert tools["approve_case"].annotations.destructiveHint is True
    for name in ("get_progress", "list_cases", "get_case", "search_crm", "get_account", "list_runs"):
        assert tools[name].annotations.readOnlyHint is True, name
    assert "explicitly confirms" in tools["run_pipeline"].description


# ---------------------------------------------------------------------------------------------- pipeline

def fake_run(monkeypatch, returncode=0, stdout="", stderr=""):
    calls = []

    def run_(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return subprocess.CompletedProcess(cmd, returncode, stdout=stdout, stderr=stderr)

    monkeypatch.setattr(server.subprocess, "run", run_)
    return calls


def test_run_pipeline_dry_run_by_default(monkeypatch):
    calls = fake_run(monkeypatch, stdout="\nScrape: 35 communities (homepage claims 35), complete=True\n"
                                         "26 cases (chow 2); 13 communities already in sync\nDry run: nothing saved.\n",
                     stderr="12:00:00 INFO pipeline: scraping")

    out = run(server.run_pipeline())

    cmd, kwargs = calls[0]
    assert cmd[1:] == ["-m", "pipeline", "run", "--dry-run"]
    assert cmd[0] == server._pipeline_python()
    assert kwargs["cwd"] == server.REPO_ROOT and kwargs["stdin"] == subprocess.DEVNULL
    assert out.startswith("`python -m pipeline run --dry-run` finished (exit 0)")
    assert "Scrape: 35 communities" in out and out.endswith("Dry run: nothing saved.")
    assert "INFO" not in out  # log lines (stderr) are not part of the summary


def test_run_pipeline_for_real_and_failure_redacts_secrets(monkeypatch):
    calls = fake_run(monkeypatch, returncode=1, stdout="",
                     stderr="Traceback ...\nheaders={'Authorization': 'Bearer abc.DEF-123'}\n"
                            "psycopg.OperationalError: postgresql://postgres:hunter2@db.example:5432/postgres\n")

    with pytest.raises(ToolError) as exc:
        run(server.run_pipeline(dry_run=False))

    assert calls[0][0][1:] == ["-m", "pipeline", "run"]
    msg = str(exc.value)
    assert msg.startswith("`python -m pipeline run` failed (exit 1).")
    assert "abc.DEF-123" not in msg and "hunter2" not in msg
    assert "Bearer [redacted]" in msg and "postgresql://[redacted]@db.example" in msg
