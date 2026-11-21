import copy
import json
from pathlib import Path

import pytest

from pipeline.models import Location

DATA = Path(__file__).resolve().parents[1] / "data"


@pytest.fixture(scope="session")
def snapshot():
    """The real website scrape and the real pre-change CRM export committed in data/."""
    scrape = json.loads((DATA / "scrapes" / "2026-11-21.json").read_text(encoding="utf-8"))
    accounts = json.loads((DATA / "crm-snapshot-before" / "accounts.json").read_text(encoding="utf-8"))
    contacts = json.loads((DATA / "crm-snapshot-before" / "contacts.json").read_text(encoding="utf-8"))
    return [Location(**l) for l in scrape["locations"]], accounts, contacts


@pytest.fixture
def crm(snapshot):
    locations, accounts, contacts = snapshot
    return locations, copy.deepcopy(accounts), copy.deepcopy(contacts)


def apply_case(case: dict, accounts: list[dict], contacts: list[dict], counter=[0]) -> None:
    """Minimal stand-in for the review app's generic executor (docs/case-contract.md), for lifecycle tests."""
    by_id = {a["account_id"]: a for a in accounts}
    refs: dict[str, str] = {}

    def resolve(v):
        return refs[v["$ref"]] if isinstance(v, dict) and "$ref" in v else v

    for op in case["operations"]:
        if op["op"] == "create_account":
            counter[0] += 1
            new_id = f"001NEWSIM{counter[0]:09d}"
            parent = by_id.get(op["fields"].get("parent_id"), {})
            acct = {"account_id": new_id, "parent_name": parent.get("name", ""), "lifetime_revenue": 0,
                    "outstanding_ar": 0, "duplicate_of_account": "", "chow_current_account": "", "note": "",
                    "created_by_candidate": True, **{k: resolve(v) for k, v in op["fields"].items()}}
            accounts.append(acct)
            by_id[new_id] = acct
            refs[op["ref"]] = new_id
        elif op["op"] == "update_account":
            acct = by_id[resolve(op["account_id"])]
            for k, v in op["fields"].items():
                acct[k] = resolve(v)
            if "parent_id" in op["fields"]:
                acct["parent_name"] = by_id.get(acct["parent_id"], {}).get("name", "")
        elif op["op"] == "append_note":
            acct = by_id[resolve(op["account_id"])]
            acct["note"] = (acct.get("note") + "\n" if acct.get("note") else "") + op["text"]
        elif op["op"] == "move_contact":
            c = next(c for c in contacts if c["contact_id"] == op["contact_id"])
            c["account_id"] = resolve(op["to_account_id"])
