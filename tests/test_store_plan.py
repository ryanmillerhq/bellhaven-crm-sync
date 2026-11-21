"""Idempotency rules of the review store (pure; no database)."""
from pipeline.store import plan_sync


def case(fp: str) -> dict:
    return {"fingerprint": fp, "kind": "rename", "title": fp}


def test_first_run_inserts_everything():
    plan = plan_sync({}, [case("a"), case("b")])
    assert [c["fingerprint"] for c in plan.insert] == ["a", "b"]
    assert plan.counts()["new"] == 2


def test_decided_cases_are_never_reproposed():
    existing = {"a": (1, "applied"), "b": (2, "rejected")}
    plan = plan_sync(existing, [case("a"), case("b")])
    assert plan.insert == [] and plan.refresh == []
    assert sorted(plan.skipped_decided) == ["a", "b"]


def test_second_identical_run_creates_nothing_new():
    first = plan_sync({}, [case("a"), case("b")])
    existing = {c["fingerprint"]: (i, "pending") for i, c in enumerate(first.insert, 1)}
    second = plan_sync(existing, [case("a"), case("b")])
    assert second.counts() == {"new": 0, "refreshed": 2, "reopened": 0, "skipped_decided": 0,
                               "left_alone": 0, "superseded": 0}


def test_pending_case_no_longer_detected_is_superseded():
    plan = plan_sync({"a": (1, "pending"), "b": (2, "pending")}, [case("a")])
    assert plan.supersede == [2]


def test_decided_cases_are_not_superseded_when_absent():
    plan = plan_sync({"a": (1, "applied"), "b": (2, "rejected")}, [])
    assert plan.supersede == []


def test_supersede_can_be_disabled_for_partial_runs():
    plan = plan_sync({"a": (1, "pending")}, [], allow_supersede=False)
    assert plan.supersede == []


def test_stale_is_refreshed_and_superseded_is_reopened():
    plan = plan_sync({"a": (1, "stale"), "b": (2, "superseded")}, [case("a"), case("b")])
    assert [(cid, prev) for cid, _, prev in plan.refresh] == [(1, "stale")]
    assert [cid for cid, _ in plan.reopen] == [2]


def test_in_flight_and_failed_cases_are_left_for_the_reviewer():
    plan = plan_sync({"a": (1, "applying"), "b": (2, "failed")}, [case("a"), case("b")])
    assert sorted(plan.left_alone) == ["a", "b"] and plan.refresh == [] and plan.insert == []


def test_duplicate_fingerprints_in_one_run_are_collapsed():
    plan = plan_sync({}, [case("a"), case("a")])
    assert len(plan.insert) == 1


def test_new_change_for_same_facility_gets_new_case_even_after_rejection():
    # A rejected rename to "X" doesn't block a later, different rename to "Y" (different fingerprint).
    plan = plan_sync({"site:foo|rename|X": (1, "rejected")}, [case("site:foo|rename|Y")])
    assert [c["fingerprint"] for c in plan.insert] == ["site:foo|rename|Y"]


def test_new_proposal_for_a_busy_facility_is_held():
    # Tiffin's CHOW failed half-way (new account created, link not written): don't propose a different case for it.
    existing = {"old-fp": (7, "failed", "site:bellhaven-of-tiffin")}
    new_case = {"fingerprint": "different-fp", "subject_key": "site:bellhaven-of-tiffin", "kind": "duplicate"}
    plan = plan_sync(existing, [new_case])
    assert plan.insert == [] and plan.left_alone == ["different-fp"]
