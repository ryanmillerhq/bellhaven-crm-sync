"""Plain-text renderings of review-app JSON, written for an LLM to reason over and relay to a human.

Shapes are the ones in docs/case-contract.md and web/lib/types.ts.
"""
from __future__ import annotations

import json
from typing import Any

APPROVABLE = ("pending", "failed")


# ---------------------------------------------------------------------------------------------- small helpers

def _cell(v: Any) -> str:
    """One markdown-table cell: no pipes or newlines, '-' for empty."""
    s = "" if v is None else str(v)
    s = s.replace("|", "/").replace("\r", " ").replace("\n", " ").strip()
    return s or "-"


def _table(headers: list[str], rows: list[list[Any]]) -> list[str]:
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(_cell(c) for c in row) + " |" for row in rows]
    return out


def money(v: Any) -> str:
    try:
        return f"${float(v):,.0f}"
    except (TypeError, ValueError):
        return _cell(v)


def _trim(s: Any, n: int) -> str:
    s = "" if s is None else str(s).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _value(v: Any, ref_sources: dict[str, str]) -> str:
    if isinstance(v, dict) and "$ref" in v:
        src = ref_sources.get(v["$ref"])
        return f"<id of the account created by step {src}>" if src else f'<id created earlier as "{v["$ref"]}">'
    return json.dumps(v, ensure_ascii=False)


def _address(street: Any, city: Any, state: Any, zip_: Any) -> str:
    tail = " ".join(x for x in (str(state or "").strip(), str(zip_ or "").strip()) if x)
    return ", ".join(x for x in (str(street or "").strip(), str(city or "").strip(), tail) if x) or "-"


# ---------------------------------------------------------------------------------------------- progress / runs

def format_progress(p: dict[str, Any]) -> str:
    total, decided = int(p.get("total") or 0), int(p.get("decided") or 0)
    pct = f"{decided / total:.0%}" if total else "n/a"
    lines = [
        f"Review progress: {decided} of {total} cases decided ({pct}).",
        f"Pending {p.get('pending', 0)} · applied {p.get('applied', 0)} · rejected {p.get('rejected', 0)} · "
        f"need attention (failed/stale/applying) {p.get('attention', 0)}.",
    ]
    by_kind = p.get("byKind") or {}
    if by_kind:
        lines += ["", "By kind (decided / total):"]
        for kind, k in sorted(by_kind.items(), key=lambda kv: (-int(kv[1].get("total") or 0), kv[0])):
            lines.append(f"- {kind}: {k.get('decided', 0)} / {k.get('total', 0)}")
    return "\n".join(lines)


def format_runs(runs: list[dict[str, Any]]) -> str:
    if not runs:
        return "No pipeline runs recorded yet."
    lines = [f"{len(runs)} most recent pipeline runs (newest first):"]
    for r in runs:
        s = r.get("summary") or {}
        sc = s.get("scrape") or {}
        parts = [f"#{r.get('id')} {r.get('trigger', '?')} · {r.get('status', '?')}",
                 f"started {r.get('started_at') or '-'}", f"finished {r.get('finished_at') or '-'}"]
        if sc:
            parts.append(f"scraped {sc.get('found_count', '?')} communities (homepage claims {sc.get('claimed_count', '?')}, "
                         f"complete={sc.get('complete')})")
        elif r.get("location_count") is not None:
            parts.append(f"{r['location_count']} communities")
        if r.get("account_count") is not None:
            parts.append(f"{r['account_count']} CRM accounts read")
        if "case_count" in s:
            kinds = ", ".join(f"{k} {v}" for k, v in sorted((s.get("cases_by_kind") or {}).items()))
            parts.append(f"{s['case_count']} cases" + (f" ({kinds})" if kinds else ""))
        if "in_sync" in s:
            parts.append(f"{s['in_sync']} in sync")
        store = s.get("store") or {}
        if store:
            parts.append("queue changes: " + (", ".join(f"{k} {v}" for k, v in store.items() if v) or "none"))
        lines.append("- " + " · ".join(parts))
        for w in sc.get("warnings") or []:
            lines.append(f"  warning: {w}")
        if sc.get("failed"):
            lines.append(f"  failed pages: {sc['failed']}")
        if r.get("error"):
            lines.append(f"  error: {r['error']}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------------- cases

def format_case_list(cases: list[dict[str, Any]], *, status: str | None, kind: str | None) -> str:
    what = f"status={status or 'any (superseded hidden)'}" + (f", kind={kind}" if kind else "")
    if not cases:
        return f"No cases match ({what})."
    show_status = not status or "," in status
    headers = ["id", "kind", "tags", "title", "confidence", "summary"] + (["status"] if show_status else [])
    rows = [[c.get("id"), c.get("kind"), ",".join(c.get("tags") or []), c.get("title"), c.get("confidence"),
             _trim(c.get("summary"), 140)] + ([c.get("status")] if show_status else []) for c in cases]
    return "\n".join([f"{len(cases)} cases ({what}). Use get_case(case_id) for the full evidence.", ""] + _table(headers, rows))


def _account_names(case: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    """account_id → 'name (role)', contact_id → 'name, title' from the accounts snapshotted on the case."""
    accounts, contacts = {}, {}
    for ca in case.get("accounts") or []:
        a = ca.get("account") or {}
        if a.get("account_id"):
            accounts[a["account_id"]] = f"“{a.get('name', '?')}”, {ca.get('role', '?')}"
        for c in ca.get("contacts") or []:
            if c.get("contact_id"):
                contacts[c["contact_id"]] = ", ".join(x for x in (c.get("name"), c.get("title")) if x) or "?"
    return accounts, contacts


def _target(v: Any, names: dict[str, str], ref_sources: dict[str, str]) -> str:
    if isinstance(v, dict):
        return _value(v, ref_sources)
    return f"{v} ({names[v]})" if v in names else str(v)


def _format_account_block(ca: dict[str, Any]) -> list[str]:
    a = ca.get("account") or {}
    parent = a.get("parent_name") or "(no parent)"
    if a.get("parent_id"):
        parent += f" [{a['parent_id']}]"
    head = f"- {ca.get('role', '?')}: {a.get('account_id', '?')} “{a.get('name', '?')}”"
    lines = [
        head,
        f"  parent {parent} · status {a.get('status') or '-'} · care type {a.get('care_type') or '-'} · phone {a.get('phone') or '-'}",
        f"  address {_address(a.get('billing_street'), a.get('billing_city'), a.get('billing_state'), a.get('billing_zip'))}",
        f"  lifetime revenue {money(a.get('lifetime_revenue'))} · outstanding AR {money(a.get('outstanding_ar'))}"
        + (f" · duplicate_of_account {a['duplicate_of_account']}" if a.get("duplicate_of_account") else "")
        + (f" · chow_current_account {a['chow_current_account']}" if a.get("chow_current_account") else ""),
    ]
    if ca.get("match_signals"):
        lines.append(f"  matched on: {', '.join(ca['match_signals'])}")
    if a.get("note"):
        lines.append(f"  CRM note: {_trim(a['note'], 400)}")
    contacts = ca.get("contacts") or []
    if contacts:
        lines.append("  contacts: " + "; ".join(
            f"{c.get('name', '?')} ({c.get('title') or 'no title'}"
            + (", inactive" if c.get("is_active") is False else "") + f") [{c.get('contact_id', '?')}]"
            for c in contacts))
    return lines


def _format_operations(case: dict[str, Any], ops: list[dict[str, Any]]) -> tuple[list[str], bool]:
    names, contact_names = _account_names(case)
    ref_sources = {op["ref"]: op.get("id", "?") for op in ops if op.get("op") == "create_account" and op.get("ref")}
    lines: list[str] = []
    any_editable = False
    for i, op in enumerate(ops, 1):
        kind = op.get("op")
        lines.append(f"{i}. [{op.get('id')}] {op.get('describe') or kind}")
        if kind == "create_account":
            lines.append(f"   create_account (its new id is referred to as \"{op.get('ref')}\")")
        elif kind == "update_account":
            lines.append(f"   update_account on {_target(op.get('account_id'), names, ref_sources)} (only these fields are sent)")
        elif kind == "append_note":
            lines.append(f"   append_note on {_target(op.get('account_id'), names, ref_sources)} (appended, never overwrites)")
            lines.append(f"   text: {json.dumps(op.get('text', ''), ensure_ascii=False)}")
        elif kind == "move_contact":
            cid = op.get("contact_id")
            who = f" ({contact_names[cid]})" if cid in contact_names else ""
            lines.append(f"   move_contact {cid}{who} → {_target(op.get('to_account_id'), names, ref_sources)}")
        editable = op.get("editable") or []
        for field, v in (op.get("fields") or {}).items():
            mark = "  (editable)" if field in editable else ""
            lines.append(f"   - {field} = {_value(v, ref_sources)}{mark}")
        if kind in ("create_account", "update_account"):
            any_editable = any_editable or bool(editable)
            lines.append(f"   editable fields: {', '.join(editable) if editable else 'none'}")
    return lines, any_editable


def format_case(case: dict[str, Any]) -> str:
    cid, status = case.get("id"), case.get("status")
    lines = [
        f"# Case #{cid}: {case.get('title')}",
        f"Kind: {case.get('kind')} · tags: {', '.join(case.get('tags') or []) or '-'} · status: {status} · "
        f"confidence: {case.get('confidence') or '-'}",
        f"Summary: {case.get('summary') or '-'}",
        f"Subject: {case.get('subject_key')} · seen in runs {case.get('first_seen_run')}–{case.get('last_seen_run')} · "
        f"updated_at {case.get('updated_at')}",
    ]
    if status not in APPROVABLE:
        lines.append(f"Note: this case is {status}; only pending or failed cases can be approved"
                     + (" (reopen_case puts it back in the queue)." if status in ("rejected", "stale") else "."))

    lines += ["", "## What we found (pipeline reasoning)"]
    lines += [f"- {r}" for r in case.get("reasoning") or []] or ["- (none recorded)"]

    loc = case.get("location")
    lines += ["", "## Website record (source of truth)"]
    if loc:
        lines.append(f"{loc.get('name')} · {_address(loc.get('street'), loc.get('city'), loc.get('state'), loc.get('zip'))}")
        lines.append(f"care offerings: {', '.join(loc.get('care_offerings') or []) or '-'} · administrator: "
                     f"{loc.get('administrator') or '-'} · phone: {loc.get('phone') or '-'}")
        lines.append(f"page: {loc.get('url') or '-'} (found on: {', '.join(loc.get('found_on') or []) or '-'})")
    else:
        lines.append("None: this case comes from the CRM-side sweep (a Bellhaven account not listed on the website).")

    lines += ["", "## CRM accounts involved (as read when proposed)"]
    for ca in case.get("accounts") or []:
        lines += _format_account_block(ca)
    if not case.get("accounts"):
        lines.append("- (none)")

    evidence = case.get("evidence") or []
    lines += ["", "## Evidence: website vs CRM"]
    if evidence:
        with_acct = len({e.get("account_id") for e in evidence if e.get("account_id")}) > 1
        headers = ["field", "website", "CRM", "match"] + (["account"] if with_acct else []) + ["note"]
        rows = [[e.get("label") or e.get("field"), e.get("website"), e.get("crm"), e.get("match")]
                + ([e.get("account_id")] if with_acct else []) + [e.get("note")] for e in evidence]
        lines += _table(headers, rows)
        lines.append("(match: same · formatting = equal after normalization · different · missing)")
    else:
        lines.append("(none)")

    sop = case.get("sop")
    if sop:
        lines += ["", "## CHOW SOP check (a parent change was considered)",
                  f"Account {sop.get('account_id')}: lifetime revenue {money(sop.get('lifetime_revenue'))}, "
                  f"outstanding AR {money(sop.get('outstanding_ar'))}; {sop.get('from_parent')} → {sop.get('to_parent')}.",
                  f"Branch: {sop.get('branch')} "
                  + ("(revenue AND open AR: keep the old account, create a new one, link it via chow_current_account)"
                     if sop.get("branch") == "chow" else "(re-parent the existing account directly)"),
                  f"Explanation: {sop.get('explanation')}"]

    ops = case.get("final_operations") or case.get("operations") or []
    which = "as executed (with reviewer edits)" if case.get("final_operations") else "what approve_case will do, in order"
    op_lines, any_editable = _format_operations(case, ops)
    lines += ["", f"## Planned steps ({which})"] + (op_lines or ["(no operations)"])
    if status in APPROVABLE:
        if any_editable:
            lines.append('To change an editable field: approve_case(case_id, edits={"<step id>": {"<field>": "<new value>"}}). '
                         "Only fields listed as editable can be changed.")
        else:
            lines.append("No editable fields: approve as proposed, or reject.")

    pre = case.get("preconditions") or []
    if pre:
        names, _ = _account_names(case)
        lines += ["", "## Preconditions (re-checked against the live CRM right before writing; any drift → stale, nothing written)"]
        lines += [f"- {_target(p.get('account_id'), names, {})}: {p.get('field')} must still be "
                  f"{json.dumps(p.get('equals'), ensure_ascii=False)}" for p in pre]

    decision = [f"decided by {case['decided_by']} via {case.get('decided_via')} at {case.get('decided_at')}"] if case.get("decided_by") else []
    if case.get("decision_note"):
        decision.append(f"note/reason: {case['decision_note']}")
    if case.get("error"):
        decision.append(f"error: {case['error']}")
    for r in case.get("result") or []:
        bits = [f"step {r.get('op_id')}: {'ok' if r.get('ok') else 'FAILED'}"]
        if r.get("created_id"):
            bits.append(f"created {r['created_id']}" + (" (adopted an identical existing account)" if r.get("adopted") else ""))
        if r.get("error"):
            bits.append(f"error: {r['error']}")
        bits.append(f"by {r.get('actor', '?')} via {r.get('via', '?')} at {r.get('at', '?')}")
        decision.append(" · ".join(bits))
    if decision:
        lines += ["", "## Decision and results"] + [f"- {d}" for d in decision]

    events = case.get("events") or []
    lines += ["", "## Audit trail"]
    if events:
        for ev in sorted(events, key=lambda e: (str(e.get("at")), e.get("id") or 0)):
            detail = ev.get("detail")
            d = "" if detail in (None, {}, []) else " · " + _trim(json.dumps(detail, ensure_ascii=False), 300)
            lines.append(f"- {ev.get('at')} · {ev.get('event')} · {ev.get('actor') or '?'} via {ev.get('via') or '?'}{d}")
    else:
        lines.append("- (no events)")
    return "\n".join(lines)


def format_results(case: dict[str, Any]) -> list[str]:
    describe = {op.get("id"): op.get("describe") for op in (case.get("final_operations") or case.get("operations") or [])}
    out = []
    for r in case.get("result") or []:
        line = f"- {r.get('op_id')} {'ok' if r.get('ok') else 'FAILED'}: {describe.get(r.get('op_id')) or ''}".rstrip(": ")
        if r.get("created_id"):
            line += f" → created {r['created_id']}" + (" (adopted an identical existing account)" if r.get("adopted") else "")
        if r.get("error"):
            line += f" · error: {r['error']}"
        out.append(line)
    return out


# ---------------------------------------------------------------------------------------------- CRM

def _account_line(a: dict[str, Any]) -> str:
    parent = a.get("parent_name") or "(no parent)"
    bits = [f"- {a.get('account_id')} “{a.get('name')}”", f"parent {parent}",
            _address(a.get("billing_street"), a.get("billing_city"), a.get("billing_state"), a.get("billing_zip")),
            a.get("care_type") or "-", a.get("status") or "-",
            f"revenue {money(a.get('lifetime_revenue'))} / AR {money(a.get('outstanding_ar'))}"]
    if a.get("duplicate_of_account"):
        bits.append(f"duplicate_of {a['duplicate_of_account']}")
    if a.get("chow_current_account"):
        bits.append(f"chow_current {a['chow_current_account']}")
    return " · ".join(str(b) for b in bits)


def format_accounts(accounts: list[dict[str, Any]], q: str) -> str:
    if not accounts:
        return f"No CRM accounts match {q!r}."
    return "\n".join([f"{len(accounts)} CRM accounts match {q!r} (use get_account for details and contacts):"]
                     + [_account_line(a) for a in accounts])


ACCOUNT_FIELDS = ("account_id", "name", "parent_name", "parent_id", "status", "care_type", "phone", "billing_street",
                  "billing_city", "billing_state", "billing_zip", "lifetime_revenue", "outstanding_ar",
                  "duplicate_of_account", "chow_current_account", "created_by_candidate", "updated_at")


def format_account(data: dict[str, Any]) -> str:
    a = data.get("account") or {}
    lines = [f"# CRM account {a.get('account_id')}: {a.get('name')}"]
    def show(field: str, v: Any) -> str:
        if field in ("lifetime_revenue", "outstanding_ar"):
            return money(v)
        return "-" if v is None or v == "" else str(v)

    for f in ACCOUNT_FIELDS[2:]:
        lines.append(f"- {f}: {show(f, a.get(f))}")
    for k, v in a.items():  # anything the API added that we don't list explicitly
        if k not in ACCOUNT_FIELDS and k != "note":
            lines.append(f"- {k}: {show(k, v)}")
    lines += ["", "Note:", (a.get("note") or "(empty)").strip()]
    contacts = data.get("contacts") or []
    lines += ["", f"Contacts ({len(contacts)}):"]
    for c in contacts:
        lines.append(f"- {c.get('contact_id')} {c.get('name')} · {c.get('title') or 'no title'} · {c.get('email') or '-'} · "
                     f"{c.get('phone') or '-'}" + (" · inactive" if c.get("is_active") is False else ""))
    return "\n".join(lines)
