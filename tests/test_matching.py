"""Matching + case building against the REAL scrape and CRM snapshot, including the multi-day lifecycle."""
import pytest

from pipeline import rules
from pipeline.match import match
from pipeline.normalize import care_types, name_similarity, street_key
from pipeline.proposals import build_cases

from .conftest import apply_case

BELLHAVEN = "0015QAPLGS3FVYEEEM"


def run(locations, accounts, contacts, today="2026-11-21", complete=True):
    return build_cases(match(locations, accounts, contacts), today, scrape_complete=complete)


@pytest.fixture
def first_run(crm):
    locations, accounts, contacts = crm
    cases, results = run(locations, accounts, contacts)
    return {c["title"]: c for c in cases}, results, crm


# ---------- normalization ----------
def test_street_formatting_variants_are_equal():
    assert street_key("1125 Logan Boulevard") == street_key("1125 Logan Blvd")
    assert street_key("4850 Northwest Sylvania Av") == street_key("4850 NW Sylvania Ave")
    assert street_key("3313 Wilmington Pk") == street_key("3313 Wilmington Pike")


def test_name_similarity_does_not_overmerge_carlisle():
    assert name_similarity("Bellhaven of Carlisle", "Bellhaven of New Carlisle", drop=rules.BRAND_TOKENS) < rules.NAME_MATCH_MIN


def test_care_type_vocabulary_mapping():
    assert care_types(["Short-Term Rehabilitation & Nursing"]) == ["Skilled Nursing"]
    assert care_types(["Assisted Living", "Memory Support"]) == ["Assisted Living", "Memory Care"]


# ---------- the CHOW SOP decision table ----------
@pytest.mark.parametrize("rev,ar,chow", [(84000, 12400, True), (47000, 0, False), (0, 5000, False),
                                         (0, 0, False), (None, None, False), (100, None, False)])
def test_sop_table(rev, ar, chow):
    assert rules.sop_requires_chow(rev, ar) is chow


# ---------- first run: every traced case from docs/matching-outline.md section 10 ----------
EXPECTED = {
    "Bellhaven of Tiffin": "chow", "Bellhaven of Marietta": "chow", "Bellhaven of Sandusky": "sold",
    "Bellhaven Crossings of Lima": "reparent", "Bellhaven Meadows of Findlay": "reparent",
    "Bellhaven of Zanesville": "reparent", "Bellhaven of Kettering": "duplicate",
    "Bellhaven Gardens of Monroe": "duplicate", "Bellhaven of Port Clinton": "duplicate",
    "Bellhaven Shores of Erie": "duplicate", "Bellhaven of Owosso": "duplicate",
    "Bellhaven of Chesterton": "rename", "Bellhaven of Chagrin Falls": "rename", "Bellhaven Willow Creek": "rename",
    "Bellhaven of Portsmouth": "field_fix", "The Arbors at Bellhaven - Dayton": "rename",
    "Bellhaven Healthcare Centre of Ashland": "rename", "Bellhaven Rehabilitation & Nursing of Grove City": "rename",
    "Bellhaven at Sycamore Ridge": "rename", "Bellhaven of Batavia": "create", "Bellhaven of Carlisle": "create",
    "Bellhaven at Union Square": "create", "Amberly Manor": "create",
    "Bellhaven Care Center of Alliance": "unlisted", "Bellhaven of Coldwater": "unlisted",
    "Bellhaven of Ashtabula": "field_fix",  # optional PO Box case (policy default: keep -> reject)
}


def test_first_run_produces_exactly_the_traced_cases(first_run):
    cases, results, _ = first_run
    assert {t: c["kind"] for t, c in cases.items()} == EXPECTED
    in_sync = {r["name"] for r in results if r["classification"] == "in_sync"}
    assert len(in_sync) == 13 and "Bellhaven of Ashtabula" in in_sync  # PO Box account still matched


def test_billing_decoys_already_under_bellhaven_get_no_chow(first_run):
    cases, results, _ = first_run
    for name in ("Bellhaven Terrace of Akron", "Bellhaven of Defiance", "Bellhaven of Meadville"):
        assert name not in cases


def test_chow_creates_new_account_and_only_links_the_old_one(first_run):
    c = first_run[0]["Bellhaven of Tiffin"]
    create, link = c["operations"]
    assert create["op"] == "create_account" and create["fields"]["parent_id"] == BELLHAVEN
    assert create["fields"]["care_type"] == "Skilled Nursing"
    assert link == {**link, "op": "update_account", "account_id": "001U6RW32TY0WSXZZB",
                    "fields": {"chow_current_account": {"$ref": "new"}}}
    assert c["sop"]["branch"] == "chow"
    assert {"account_id": "001U6RW32TY0WSXZZB", "field": "outstanding_ar", "equals": 12400} in c["preconditions"]


def test_reparent_without_open_ar_moves_the_existing_account(first_run):
    c = first_run[0]["Bellhaven Crossings of Lima"]
    assert c["sop"]["branch"] == "reparent"
    assert c["operations"][0]["fields"] == {"parent_id": BELLHAVEN}


def test_sandusky_links_to_existing_millstone_account(first_run):
    c = first_run[0]["Bellhaven of Sandusky"]
    assert c["operations"][0]["fields"] == {"chow_current_account": "0017JP8Z1UQ763BVK3"}
    assert not any(op["op"] == "create_account" for op in c["operations"])
    assert not any(op.get("account_id") == "001SXSF4ELF0Z2LGDM" and op["op"] == "append_note" for op in c["operations"])


def test_kettering_survivor_and_duplicates(first_run):
    c = first_run[0]["Bellhaven of Kettering"]
    survivor = next(a for a in c["accounts"] if a["role"] == "survivor")["account"]["account_id"]
    assert survivor == "0016KTS1UAWBRXS09J"
    dups = {op["account_id"]: op["fields"] for op in c["operations"]
            if op["op"] == "update_account" and "duplicate_of_account" in op["fields"]}
    assert dups == {"001WR41PYNWXCAE2X4": {"duplicate_of_account": survivor, "status": "Inactive"},
                    "001B7XZAA3AFALS9GP": {"duplicate_of_account": survivor, "status": "Inactive"}}
    assert "lowest account id" in c["reasoning"][1]


def test_owosso_keeps_administrator_match_and_moves_contact(first_run):
    c = first_run[0]["Bellhaven of Owosso"]
    assert next(a for a in c["accounts"] if a["role"] == "survivor")["account"]["account_id"] == "001EGU7BMJ942ZTRE6"
    moves = [op for op in c["operations"] if op["op"] == "move_contact"]
    assert len(moves) == 1 and moves[0]["to_account_id"] == "001EGU7BMJ942ZTRE6"


def test_lookalikes_are_not_matched(first_run):
    cases = first_run[0]
    amberly = cases["Amberly Manor"]
    assert [a["account"]["account_id"] for a in amberly["accounts"] if a["role"] == "lookalike"] == ["0015D74ZLRY810RGY5"]
    assert cases["Bellhaven at Union Square"]["kind"] == "create"


def test_phone_is_never_written_and_po_box_is_only_an_optional_case(first_run):
    for title, c in first_run[0].items():
        for op in c["operations"]:
            if op["op"] == "update_account":
                assert "phone" not in op["fields"]
                if op["account_id"] == "001NXP9X46CWEPSLSV":
                    assert "optional" in c["tags"] and c["confidence"] == "low"


def test_portsmouth_fixes_only_the_zip(first_run):
    upd = first_run[0]["Bellhaven of Portsmouth"]["operations"][0]
    assert upd["fields"] == {"billing_zip": "45662"}


# ---------- idempotency & lifecycle ----------
def test_fingerprints_are_stable_across_days(crm):
    locations, accounts, contacts = crm
    a, _ = run(locations, accounts, contacts, today="2026-11-21")
    b, _ = run(locations, accounts, contacts, today="2026-11-22")
    assert [c["fingerprint"] for c in a] == [c["fingerprint"] for c in b]


def test_after_approving_everything_the_next_run_proposes_nothing(crm):
    locations, accounts, contacts = crm
    cases, _ = run(locations, accounts, contacts)
    for c in cases:
        apply_case(c, accounts, contacts)
    again, results = run(locations, accounts, contacts, today="2026-11-22")
    assert again == [], [(c["title"], c["kind"]) for c in again]
    assert sum(1 for r in results if r["classification"] == "in_sync") == 35


def test_chow_old_and_new_accounts_are_not_flagged_as_duplicates_next_day(crm):
    locations, accounts, contacts = crm
    cases, _ = run(locations, accounts, contacts)
    tiffin = next(c for c in cases if c["title"] == "Bellhaven of Tiffin")
    apply_case(tiffin, accounts, contacts)
    again, _ = run(locations, accounts, contacts, today="2026-11-22")
    assert "Bellhaven of Tiffin" not in {c["title"] for c in again}


def test_incomplete_scrape_disables_the_unlisted_sweep(crm):
    locations, accounts, contacts = crm
    cases, _ = run(locations[:-5], accounts, contacts, complete=False)
    assert not any(c["kind"] in ("unlisted", "sold") for c in cases)


# ---------- adversarial-review fixes ----------
def _decided(cases, *titles):
    from pipeline.proposals import decided_keys_from_cases
    return decided_keys_from_cases([c for c in cases if c["title"] in titles])


def test_rejected_po_box_case_is_not_reproposed(crm):
    locations, accounts, contacts = crm
    cases, _ = run(locations, accounts, contacts)
    po = [c for c in cases if "po_box" in c["tags"]]
    again, _ = build_cases(match(locations, accounts, contacts), "2026-11-22", True,
                           decided=_decided(po, "Bellhaven of Ashtabula"))
    assert not any("po_box" in c["tags"] for c in again)


def test_reviewer_edit_before_approval_is_not_reproposed(crm):
    locations, accounts, contacts = crm
    cases, _ = run(locations, accounts, contacts)
    zan = next(c for c in cases if c["title"] == "Bellhaven of Zanesville")
    edited = {**zan, "operations": [
        {**op, "fields": {**op["fields"], "name": "Bellhaven Zanesville (edited)"}} if op["op"] == "update_account" else op
        for op in zan["operations"]]}
    apply_case(edited, accounts, contacts)  # executor writes the reviewer's edited name
    again, _ = build_cases(match(locations, accounts, contacts), "2026-11-22", True,
                           decided=_decided(cases, "Bellhaven of Zanesville"))
    assert "Bellhaven of Zanesville" not in {c["title"] for c in again}


def test_billing_duplicate_under_old_parent_is_linked_not_inactivated(crm):
    locations, accounts, contacts = crm
    accounts.append({"account_id": "001TESTPREDECESS0", "name": "Cedar Trail Gardens of Monroe",
                     "parent_id": "001FWSQ30SFW6S7604", "parent_name": "Cedar Trail Communities (Parent Account)",
                     "billing_street": "750 Stewart Rd", "billing_city": "Monroe", "billing_state": "MI",
                     "billing_zip": "48162", "care_type": "Assisted Living", "status": "Active", "phone": "",
                     "lifetime_revenue": 50000, "outstanding_ar": 2500, "duplicate_of_account": "",
                     "chow_current_account": "", "note": ""})
    cases, _ = run(locations, accounts, contacts)
    monroe = next(c for c in cases if c["title"] == "Bellhaven Gardens of Monroe")
    ops = {op["account_id"]: op["fields"] for op in monroe["operations"] if op["op"] == "update_account"}
    assert ops["001TESTPREDECESS0"] == {"chow_current_account": "001U1750VLVJAGG1S5"}
    assert monroe["kind"] == "chow" and "duplicate" in monroe["tags"]


def test_sold_with_revenue_but_no_ar_reparents_per_sop(crm):
    locations, accounts, contacts = crm
    next(a for a in accounts if a["account_id"] == "001SXSF4ELF0Z2LGDM")["outstanding_ar"] = 0
    cases, _ = run(locations, accounts, contacts)
    c = next(c for c in cases if c["title"] == "Bellhaven of Sandusky")
    assert c["tags"] == ["sold", "reparent", "duplicate"] and c["sop"]["branch"] == "reparent"
    ups = {op["account_id"]: op["fields"] for op in c["operations"] if op["op"] == "update_account"}
    assert ups["001SXSF4ELF0Z2LGDM"] == {"parent_id": "001YRHHXQ5HJ0TCL2U"}
    assert ups["0017JP8Z1UQ763BVK3"] == {"duplicate_of_account": "001SXSF4ELF0Z2LGDM", "status": "Inactive"}


def test_chow_never_touches_the_old_account_beyond_the_link(first_run):
    for title in ("Bellhaven of Tiffin", "Bellhaven of Marietta"):
        c = first_run[0][title]
        old = next(a for a in c["accounts"] if a["role"] == "old_record")["account"]["account_id"]
        touching = [op for op in c["operations"] if op.get("account_id") == old]
        assert [op["fields"] for op in touching] == [{"chow_current_account": {"$ref": "new"}}]


def test_in_sync_rows_flag_stale_administrator_contacts(first_run):
    _, results, _ = first_run
    wooster = next(r for r in results if r["name"] == "Bellhaven of Wooster")
    assert wooster["classification"] == "in_sync" and "Lorna Sorensen" in wooster["notes"][0]
