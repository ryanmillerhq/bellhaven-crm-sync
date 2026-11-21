"""Link website locations to CRM accounts.

Address is identity; names are labels. A name alone never makes a match (the CRM contains same-name decoys in other
states and same-zip lookalikes at other streets). See docs/matching-outline.md.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import rules
from .models import Location
from .normalize import is_po_box, name_similarity, parent_display, person_key, phone_key, street_key


@dataclass
class Signals:
    address: bool  # normalized street + state + (zip or city)
    gate: bool  # same state AND (same zip OR same city)
    administrator: bool  # a contact on the account is the site's administrator
    phone: bool
    name_similarity: int
    street_exact: bool  # street written exactly like the site (tie-breaker only)
    po_box: bool = False  # CRM street is a PO Box, so address can never match

    def supporting(self) -> list[str]:
        out = []
        if self.administrator:
            out.append("administrator")
        if self.phone:
            out.append("phone")
        if self.name_similarity >= rules.NAME_MATCH_MIN:
            out.append("name")
        return out

    def is_match(self) -> bool:
        if self.address:
            return True
        if self.gate and self.po_box and self.name_similarity == 100:
            return True  # PO Box account: same locality + identical name is enough (phone/admin can drift)
        return self.gate and len(self.supporting()) >= rules.MIN_SUPPORTING_SIGNALS

    def labels(self) -> list[str]:
        return (["address"] if self.address else (["locality"] if self.gate else [])) + self.supporting()

    def confidence(self) -> str:
        if self.address and self.supporting():
            return "high"
        return "medium"

    def score(self) -> float:
        return (100 if self.address else 0) + (40 if self.administrator else 0) + (25 if self.phone else 0) \
            + self.name_similarity / 5 + (5 if self.gate else 0)


@dataclass
class Candidate:
    account: dict
    signals: Signals


@dataclass
class LocationMatch:
    location: Location
    matches: list[Candidate] = field(default_factory=list)  # best first
    lookalikes: list[tuple[dict, str]] = field(default_factory=list)  # (account, why it is NOT a match)


@dataclass
class MatchOutcome:
    operator_id: str
    parents: dict[str, dict]  # parent account id → account
    contacts_by_account: dict[str, list[dict]]
    by_location: list[LocationMatch]
    unmatched_operator_accounts: list[dict]  # parented to the operator, active, matched to no location
    resolved: list[dict]  # accounts already settled (duplicate_of_account / chow_current_account set)
    pool: list[dict]  # facility accounts eligible for matching


def is_parent_account(account: dict, parent_ids: set[str]) -> bool:
    return account["account_id"] in parent_ids or account.get("name", "").lower().endswith("(parent account)")


def is_resolved(account: dict) -> bool:
    """Already settled by an earlier decision: a duplicate loser, or an old account preserved by a CHOW."""
    return bool(account.get("duplicate_of_account")) or bool(account.get("chow_current_account"))


def compute_signals(loc: Location, account: dict, contacts: list[dict]) -> Signals:
    same_state = (account.get("billing_state") or "").upper() == loc.state.upper()
    same_zip = (account.get("billing_zip") or "")[:5] == loc.zip
    same_city = (account.get("billing_city") or "").strip().lower() == loc.city.strip().lower()
    street_eq = bool(loc.street) and street_key(account.get("billing_street")) == street_key(loc.street)
    admin_key = person_key(loc.administrator)
    return Signals(
        address=street_eq and same_state and (same_zip or same_city),
        gate=same_state and (same_zip or same_city),
        administrator=bool(admin_key) and any(person_key(c.get("name")) == admin_key for c in contacts
                                              if c.get("is_active", True)),
        phone=bool(phone_key(loc.phone)) and phone_key(account.get("phone")) == phone_key(loc.phone),
        name_similarity=name_similarity(loc.name, account.get("name"), drop=rules.BRAND_TOKENS),
        street_exact=(account.get("billing_street") or "").strip().lower() == loc.street.strip().lower(),
        po_box=is_po_box(account.get("billing_street")),
    )


def find_operator_id(accounts: list[dict]) -> str:
    target = rules.OPERATOR_PARENT_NAME.lower()
    for a in accounts:
        if parent_display(a.get("name")).lower() == target:
            return a["account_id"]
    raise ValueError(f"No parent account named {rules.OPERATOR_PARENT_NAME!r} in the CRM")


def match(locations: list[Location], accounts: list[dict], contacts: list[dict]) -> MatchOutcome:
    parent_ids = {a["parent_id"] for a in accounts if a.get("parent_id")}
    operator_id = find_operator_id(accounts)
    parents = {a["account_id"]: a for a in accounts if is_parent_account(a, parent_ids)}
    by_acct: dict[str, list[dict]] = {}
    for c in contacts:
        by_acct.setdefault(c.get("account_id", ""), []).append(c)

    facilities = [a for a in accounts if a["account_id"] not in parents]
    resolved = [a for a in facilities if is_resolved(a)]
    pool = [a for a in facilities if not is_resolved(a)]

    results: list[LocationMatch] = []
    claims: dict[str, list[tuple[float, int]]] = {}  # account id → [(score, location index)]
    for i, loc in enumerate(locations):
        lm = LocationMatch(location=loc)
        for a in pool:
            sig = compute_signals(loc, a, by_acct.get(a["account_id"], []))
            if sig.is_match():
                lm.matches.append(Candidate(a, sig))
                claims.setdefault(a["account_id"], []).append((sig.score(), i))
            elif sig.name_similarity >= rules.LOOKALIKE_MIN or (sig.gate and sig.name_similarity >= 60):
                lm.lookalikes.append((a, _why_not(loc, a, sig)))
        lm.matches.sort(key=lambda c: -c.signals.score())
        lm.lookalikes = sorted(lm.lookalikes, key=lambda t: -name_similarity(loc.name, t[0].get("name"),
                                                                              drop=rules.BRAND_TOKENS))[:3]
        results.append(lm)

    # An account can belong to only one location: keep it where it scores best.
    for acct_id, cl in claims.items():
        if len(cl) > 1:
            best_loc = max(cl)[1]
            for _, li in cl:
                if li != best_loc:
                    results[li].matches = [c for c in results[li].matches if c.account["account_id"] != acct_id]

    # Pointer fallback: a location with no live match but a settled record at its address follows that record's
    # pointer (e.g. an old CHOW'd account → its current account), instead of proposing a duplicate create.
    pool_by_id = {a["account_id"]: a for a in pool}
    for lm in results:
        if lm.matches:
            continue
        for r in resolved:
            if compute_signals(lm.location, r, []).address:
                target = pool_by_id.get(r.get("chow_current_account") or r.get("duplicate_of_account"))
                if target is not None:
                    sig = compute_signals(lm.location, target, by_acct.get(target["account_id"], []))
                    lm.matches.append(Candidate(target, sig))
                    break

    matched_ids = {c.account["account_id"] for lm in results for c in lm.matches}
    unmatched = [a for a in pool if a.get("parent_id") == operator_id and a["account_id"] not in matched_ids
                 and a.get("status") == "Active"]
    return MatchOutcome(operator_id=operator_id, parents=parents, contacts_by_account=by_acct, by_location=results,
                        unmatched_operator_accounts=unmatched, resolved=resolved, pool=pool)


def _why_not(loc: Location, a: dict, sig: Signals) -> str:
    where = f"{a.get('billing_street')}, {a.get('billing_city')} {a.get('billing_state')}"
    if (a.get("billing_state") or "").upper() != loc.state.upper():
        return f"Similar name but a different state ({where})"
    if is_po_box(a.get("billing_street")):
        return f"PO Box address and too few other signals ({where})"
    if sig.gate:
        return f"Same area but a different street ({where}); phone and administrator don't match either"
    return f"Similar name but a different city ({where})"


def same_address_accounts(account: dict, pool: list[dict]) -> list[dict]:
    """Other live accounts at this account's address (used to detect a facility sold to another parent)."""
    key, state = street_key(account.get("billing_street")), (account.get("billing_state") or "").upper()
    zip5, city = (account.get("billing_zip") or "")[:5], (account.get("billing_city") or "").lower()
    if not key or is_po_box(account.get("billing_street")):
        return []
    return [o for o in pool if o["account_id"] != account["account_id"]
            and street_key(o.get("billing_street")) == key and (o.get("billing_state") or "").upper() == state
            and ((o.get("billing_zip") or "")[:5] == zip5 or (o.get("billing_city") or "").lower() == city)]
