"""Turn match results into review cases (docs/case-contract.md).

One case per facility, bundling every change it needs. The review app's executor is generic, so ALL business rules
(CHOW SOP, duplicate survivor, field policy) are decided here and shown to the reviewer as reasoning, evidence and
an SOP check before they click Approve.
"""
from __future__ import annotations

import hashlib
import json

from . import rules
from .match import Candidate, LocationMatch, MatchOutcome, same_address_accounts
from .models import Location
from .normalize import (care_types, is_po_box, name_key, name_similarity, parent_display, person_key, phone_key,
                        street_key)

KIND_PRIORITY = ["chow", "sold", "duplicate", "reparent", "create", "unlisted", "rename", "field_fix", "reactivate"]
EDITABLE_ON_CREATE = ["name", "billing_street", "billing_city", "billing_state", "billing_zip", "care_type", "phone"]
EDITABLE_ON_UPDATE = {"name", "billing_street", "billing_city", "billing_state", "billing_zip", "care_type", "phone"}
FIELD_LABEL = {"name": "name", "billing_street": "street", "billing_city": "city", "billing_state": "state",
               "billing_zip": "zip", "care_type": "care type", "phone": "phone", "status": "status",
               "parent_id": "parent company"}


def money(x) -> str:
    return f"${(x or 0):,.0f}"


def fingerprint(kind: str, subject: str, operations: list[dict]) -> str:
    """Identity of a decision = what it would change, not when or why. Notes, dates, contact moves and op ids are
    excluded so the same proposal hashes the same every day; a genuinely different change hashes differently."""
    canon = []
    for op in operations:
        if op["op"] in ("create_account", "update_account"):
            fields = {k: v for k, v in op["fields"].items() if k != "note"}
            canon.append([op["op"], op.get("account_id") or op.get("ref"), sorted(fields.items(), key=lambda kv: kv[0])])
    blob = json.dumps([kind, subject, sorted(canon, key=json.dumps)], sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


class CaseBuilder:
    def __init__(self, outcome: MatchOutcome, today: str):
        self.o = outcome
        self.today = today
        self.operator_id = outcome.operator_id
        self.operator_name = parent_display(outcome.parents[outcome.operator_id]["name"])
        self._n = 0

    # ---------- small helpers ----------
    def _op_id(self) -> str:
        self._n += 1
        return f"op{self._n}"

    def note(self, text: str) -> str:
        return f"[{rules.NOTE_TAG} {self.today}] {text}"

    def parent_name(self, account: dict) -> str:
        pid = account.get("parent_id")
        if not pid:
            return "no parent"
        return parent_display(self.o.parents.get(pid, {}).get("name") or account.get("parent_name")) or pid

    def contacts(self, account_id: str) -> list[dict]:
        return self.o.contacts_by_account.get(account_id, [])

    def case_account(self, role: str, account: dict, signals: list[str] | None = None) -> dict:
        d = {"role": role, "account": account, "contacts": self.contacts(account["account_id"])}
        if signals is not None:
            d["match_signals"] = signals
        return d

    @staticmethod
    def preconditions_for(account: dict, fields: list[str]) -> list[dict]:
        return [{"account_id": account["account_id"], "field": f, "equals": account.get(f) if account.get(f) is not None else ""}
                for f in fields]

    def update(self, account_id, fields: dict, describe: str, editable: list[str] | None = None) -> dict:
        return {"id": self._op_id(), "op": "update_account", "account_id": account_id, "fields": fields,
                "editable": editable or [], "describe": describe}

    def append_note(self, account_id, text: str, describe: str) -> dict:
        return {"id": self._op_id(), "op": "append_note", "account_id": account_id, "text": self.note(text),
                "describe": describe}

    def create(self, loc: Location, note: str, describe: str, parent_id: str | None = None) -> dict:
        ct = care_types(loc.care_offerings)
        fields = {"name": loc.name, "parent_id": parent_id or self.operator_id, "billing_street": loc.street,
                  "billing_city": loc.city, "billing_state": loc.state, "billing_zip": loc.zip,
                  "care_type": ct[0] if ct else "", "phone": loc.phone, "status": "Active", "note": self.note(note)}
        return {"id": self._op_id(), "op": "create_account", "ref": "new", "fields": fields,
                "editable": EDITABLE_ON_CREATE, "describe": describe}

    # ---------- field comparison ----------
    def field_changes(self, loc: Location, acct: dict) -> tuple[dict, list[str]]:
        """Fields on an existing account that should take the website's value, plus tags describing them."""
        changes: dict = {}
        tags: list[str] = []
        if (acct.get("name") or "").strip() != loc.name.strip():
            cosmetic = name_similarity(loc.name, acct.get("name")) >= rules.COSMETIC_RENAME_MIN
            if not cosmetic or rules.PROPOSE_COSMETIC_RENAMES:
                changes["name"] = loc.name
                tags += ["rename"] + (["cosmetic"] if cosmetic else [])
        crm_street = acct.get("billing_street") or ""
        if street_key(crm_street) != street_key(loc.street) and not (rules.LEAVE_PO_BOX_STREETS and is_po_box(crm_street)):
            changes["billing_street"] = loc.street
        if (acct.get("billing_city") or "").strip().lower() != loc.city.lower():
            changes["billing_city"] = loc.city
        if (acct.get("billing_state") or "").upper() != loc.state.upper():
            changes["billing_state"] = loc.state
        if (acct.get("billing_zip") or "")[:5] != loc.zip:
            changes["billing_zip"] = loc.zip
        mapped = care_types(loc.care_offerings)
        if rules.SYNC_CARE_TYPE and mapped and acct.get("care_type") not in mapped:
            changes["care_type"] = mapped[0]
        if rules.SYNC_PHONE and phone_key(acct.get("phone")) != phone_key(loc.phone):
            changes["phone"] = loc.phone
        if set(changes) - {"name"}:
            tags.append("field_fix")
        if acct.get("status") != "Active":
            changes["status"] = "Active"
            tags.append("reactivate")
        return changes, tags

    def evidence(self, loc: Location | None, acct: dict | None, compact: bool = False) -> list[dict]:
        rows: list[dict] = []
        aid = acct["account_id"] if acct else None

        def row(field, label, website, crm, match, note=None):
            r = {"field": field, "label": label, "website": website, "crm": crm, "match": match}
            if aid:
                r["account_id"] = aid
            if note:
                r["note"] = note
            rows.append(r)

        def cmp(w, c, fmt_equal=False):
            if c in (None, ""):
                return "missing"
            if w is None:
                return "different"
            if str(w).strip().lower() == str(c).strip().lower():
                return "same"
            return "formatting" if fmt_equal else "different"

        a = acct or {}
        w_name = loc.name if loc else None
        row("name", "Name", w_name, a.get("name"),
            cmp(w_name, a.get("name"), bool(loc and acct and name_key(loc.name) == name_key(a.get("name")))))
        crm_parent = self.parent_name(a) if acct else None
        row("parent", "Parent company", self.operator_name if loc else None, crm_parent,
            "missing" if not acct else ("same" if a.get("parent_id") == self.operator_id and loc else "different"))
        w_street = loc.street if loc else None
        street_note = "PO Box: billing address left as is" if acct and is_po_box(a.get("billing_street")) else None
        row("street", "Street", w_street, a.get("billing_street"),
            cmp(w_street, a.get("billing_street"),
                bool(loc and acct and street_key(loc.street) == street_key(a.get("billing_street")))), street_note)
        if not compact:
            row("city", "City", loc.city if loc else None, a.get("billing_city"), cmp(loc.city if loc else None, a.get("billing_city")))
            row("state", "State", loc.state if loc else None, a.get("billing_state"), cmp(loc.state if loc else None, a.get("billing_state")))
        row("zip", "Zip", loc.zip if loc else None, a.get("billing_zip"), cmp(loc.zip if loc else None, a.get("billing_zip")))
        if not compact:
            mapped = care_types(loc.care_offerings) if loc else []
            care_w = ", ".join(loc.care_offerings) if loc else None
            care_match = "missing" if not a.get("care_type") else ("same" if a.get("care_type") in mapped else "different")
            row("care_type", "Care type", care_w, a.get("care_type"), care_match if loc else "different",
                f"Website terms map to: {', '.join(mapped)}" if mapped and care_w != a.get("care_type") else None)
        contacts = self.contacts(aid) if aid else []
        admin = loc.administrator if loc else None
        hit = next((c for c in contacts if admin and person_key(c.get("name")) == person_key(admin)), None)
        admins = [c["name"] for c in contacts if "administrator" in (c.get("title") or "").lower()]
        row("administrator", "Administrator", admin, hit["name"] if hit else (", ".join(admins) or None),
            "same" if hit else ("missing" if not admins else "different"),
            None if hit or not admin else ("No contact on this account matches the website's administrator"
                                           if contacts else "No contacts on this account"))
        if not compact or (loc and acct):
            row("phone", "Phone", loc.phone if loc else None, a.get("phone"),
                "same" if loc and phone_key(loc.phone) == phone_key(a.get("phone")) else cmp(loc.phone if loc else None, a.get("phone")),
                None if rules.SYNC_PHONE else "Evidence only (phone is not synced)")
        row("status", "Status", "Listed on website" if loc else "Not on website", a.get("status"),
            "same" if (loc and a.get("status") == "Active") else ("missing" if not acct else "different"))
        return rows

    # ---------- survivor ----------
    def survivor_key(self, cand: Candidate, loc: Location):
        a = cand.account
        billing = (a.get("lifetime_revenue") or 0) > 0 or (a.get("outstanding_ar") or 0) > 0
        return (not billing, a.get("parent_id") != self.operator_id, not cand.signals.administrator,
                not cand.signals.phone, -len(self.contacts(a["account_id"])), not cand.signals.street_exact,
                a["account_id"])

    # ---------- per-location cases ----------
    def location_case(self, lm: LocationMatch) -> tuple[dict | None, dict]:
        loc = lm.location
        subject = f"site:{loc.slug}"
        if not lm.matches:
            case = self.create_case(lm)
            return case, {"subject_key": subject, "name": loc.name, "classification": "case", "account_id": None,
                          "account_name": None, "confidence": case["confidence"], "signals": []}

        ranked = sorted(lm.matches, key=lambda c: self.survivor_key(c, loc))
        survivor, losers = ranked[0], ranked[1:]
        billed = [c for c in lm.matches if (c.account.get("lifetime_revenue") or 0) > 0 or (c.account.get("outstanding_ar") or 0) > 0]
        if losers and len(billed) > 1:
            return self.ambiguous_duplicate_case(lm), self._mr(subject, loc, survivor, "case")

        t = survivor.account
        ops: list[dict] = []
        tags: list[str] = []
        reasoning: list[str] = []
        preconds: list[dict] = []
        sop = None
        changes, change_tags = self.field_changes(loc, t)
        parent_move = t.get("parent_id") != self.operator_id
        current_ref = t["account_id"]  # the record that represents the facility after approval

        signals_txt = " + ".join(survivor.signals.labels())
        reasoning.append(f"Matched to CRM account “{t['name']}” ({t['account_id']}) on {signals_txt}.")

        if parent_move:
            chow = rules.sop_requires_chow(t.get("lifetime_revenue"), t.get("outstanding_ar"))
            from_parent = self.parent_name(t)
            sop = {"account_id": t["account_id"], "lifetime_revenue": t.get("lifetime_revenue") or 0,
                   "outstanding_ar": t.get("outstanding_ar") or 0, "from_parent": from_parent,
                   "to_parent": self.operator_name, "branch": "chow" if chow else "reparent"}
            preconds += self.preconditions_for(t, ["parent_id", "lifetime_revenue", "outstanding_ar",
                                                   "chow_current_account", "duplicate_of_account", "status"])
            if chow:
                tags.append("chow")
                sop["explanation"] = (f"Billing history ({money(t.get('lifetime_revenue'))}) AND open AR "
                                      f"({money(t.get('outstanding_ar'))}). Per the CHOW SOP the existing account stays "
                                      f"exactly as it is under {from_parent}; a new account is created under "
                                      f"{self.operator_name} and the old one points to it via chow_current_account.")
                reasoning.append(f"The website lists it as a {self.operator_name} community, but the CRM still has it "
                                 f"under {from_parent}, with billing history and open AR.")
                ops.append(self.create(loc, f"Created for change of ownership from {from_parent}. Predecessor account "
                                            f"{t['account_id']} kept unchanged for billing (lifetime revenue "
                                            f"{money(t.get('lifetime_revenue'))}, outstanding AR "
                                            f"{money(t.get('outstanding_ar'))}) per CHOW SOP.",
                                       f"Create “{loc.name}” under {self.operator_name} with the website's details"))
                ops.append(self.update(t["account_id"], {"chow_current_account": {"$ref": "new"}},
                                       f"Point the old {from_parent} account to the new one (chow_current_account); "
                                       f"leave everything else on it untouched"))
                if rules.NOTE_ON_CHOW_OLD_ACCOUNT:
                    ops.append(self.append_note(t["account_id"], "Change of ownership: see chow_current_account.",
                                                "Note the change of ownership on the old account"))
                current_ref = {"$ref": "new"}
            else:
                tags.append("reparent")
                why = ("no billing history" if not (t.get("lifetime_revenue") or 0) > 0 else
                       f"billing history ({money(t.get('lifetime_revenue'))}) but no open AR")
                sop["explanation"] = (f"{why[0].upper() + why[1:]}, so per the CHOW SOP the existing account is "
                                      f"re-parented directly from {from_parent} to {self.operator_name}.")
                reasoning.append(f"The website lists it as a {self.operator_name} community, but the CRM " +
                                 ("account has no parent company." if not t.get("parent_id") else f"has it under {from_parent}."))
                fields = {"parent_id": self.operator_id, **changes}
                ops.append(self.update(t["account_id"], fields,
                                       self._describe_update(t, fields, from_parent),
                                       [f for f in fields if f in EDITABLE_ON_UPDATE]))
                tags += change_tags
                if "name" in changes:
                    preconds += self.preconditions_for(t, ["name"])
        elif changes:
            tags += change_tags
            ops.append(self.update(t["account_id"], changes, self._describe_update(t, changes, None),
                                   [f for f in changes if f in EDITABLE_ON_UPDATE]))
            preconds += self.preconditions_for(t, sorted(set(["status", "duplicate_of_account"]) |
                                                         ({"name"} if "name" in changes else set())))

        if not parent_move or tags[:1] != ["chow"]:
            if "name" in changes:
                reasoning.append(("Name differs only in spelling/punctuation from the website's “"
                                  if "cosmetic" in change_tags else "CRM name “") +
                                 (f"{loc.name}”." if "cosmetic" in change_tags else
                                  f"{t['name']}” is outdated; the website now calls it “{loc.name}”."))
            for f in ("billing_street", "billing_city", "billing_state", "billing_zip", "care_type"):
                if f in changes:
                    reasoning.append(f"CRM {FIELD_LABEL[f]} “{t.get(f)}” differs from the website (“{changes[f]}”).")
            if "status" in changes:
                reasoning.append(f"Account is {t.get('status')} but the community is listed live on the website.")

        for c in losers:
            a = c.account
            tags.append("duplicate")
            ops.append(self.update(a["account_id"], {"duplicate_of_account": current_ref, "status": "Inactive"},
                                   f"Mark “{a['name']}” ({self.parent_name(a)}) as a duplicate of the surviving record "
                                   f"and set it Inactive"))
            ops.append(self.append_note(a["account_id"],
                                        f"Duplicate of {t['account_id'] if isinstance(current_ref, str) else 'the new current account'} "
                                        f"(“{loc.name}”, {loc.street}, {loc.city} {loc.state}). Same facility; marked "
                                        f"Inactive (no merge/delete in CRM).",
                                        f"Explain the duplicate in the note on “{a['name']}”"))
            preconds += self.preconditions_for(a, ["duplicate_of_account", "chow_current_account", "status"])
            if rules.MOVE_DUPLICATE_CONTACTS:
                for ct in self.contacts(a["account_id"]):
                    if ct.get("is_active", True):
                        ops.append({"id": self._op_id(), "op": "move_contact", "contact_id": ct["contact_id"],
                                    "to_account_id": current_ref,
                                    "describe": f"Move contact {ct['name']} ({ct.get('title') or 'contact'}) to the surviving record"})
        if losers:
            names = ", ".join(f"“{c.account['name']}” ({self.parent_name(c.account)})" for c in losers)
            reasoning.insert(1, f"{len(lm.matches)} CRM accounts sit at this address. Keeping "
                                f"“{t['name']}” ({self._survivor_reason(survivor, losers, loc)}); duplicates: {names}.")

        if parent_move and tags[:1] != ["chow"] or changes or losers or tags[:1] == ["chow"]:
            if not ops:
                return None, self._mr(subject, loc, survivor, "in_sync")
            # append an audit note to the surviving existing record when it is modified (not for CHOW old accounts)
            if isinstance(current_ref, str) and any(o["op"] == "update_account" and o["account_id"] == t["account_id"] for o in ops):
                ops.insert(1, self.append_note(t["account_id"], self._audit_text(t, changes, parent_move, losers),
                                               f"Record what changed in the note on “{loc.name}”"))
            kind = next(k for k in KIND_PRIORITY if k in tags)
            accounts = [self.case_account("survivor" if losers else ("old_record" if kind == "chow" else "target"), t,
                                          survivor.signals.labels())]
            accounts += [self.case_account("duplicate", c.account, c.signals.labels()) for c in losers]
            evidence = self.evidence(loc, t) + [r for c in losers for r in self.evidence(loc, c.account, compact=True)]
            case = self._case(kind, tags, subject, loc.name, self._summary(kind, tags, t, loc), reasoning, loc,
                              accounts, evidence, sop, survivor.signals.confidence(), ops, preconds)
            return case, self._mr(subject, loc, survivor, "case")
        return None, self._mr(subject, loc, survivor, "in_sync")

    def create_case(self, lm: LocationMatch) -> dict:
        loc = lm.location
        reasoning = [f"No CRM account matches {loc.street}, {loc.city} {loc.state} {loc.zip} on address, and no account "
                     f"in the area matches on administrator, phone and name."]
        if loc.found_on == ["homepage"]:
            reasoning.append("Only linked from the homepage (new community), not yet in the website directory.")
        for acct, why in lm.lookalikes:
            reasoning.append(f"Not the same facility: “{acct['name']}” ({self.parent_name(acct)}). {why}.")
        reasoning.append(f"Create it under {self.operator_name} with the website's details.")
        op = self.create(loc, f"Created: listed on the {self.operator_name} website ({loc.url}) but no CRM account existed.",
                         f"Create “{loc.name}” under {self.operator_name}")
        accounts = [self.case_account("lookalike", a, []) for a, _ in lm.lookalikes]
        return self._case("create", ["create"], f"site:{loc.slug}", loc.name,
                          f"Missing from the CRM: new {self.operator_name} community to create", reasoning, loc,
                          accounts, self.evidence(loc, None), None, "high" if not lm.lookalikes else "medium", [op], [])

    def ambiguous_duplicate_case(self, lm: LocationMatch) -> dict:
        loc = lm.location
        ops, preconds = [], []
        for c in lm.matches:
            a = c.account
            ops.append(self.update(a["account_id"], {"status": "Needs Review"}, f"Flag “{a['name']}” for review"))
            ops.append(self.append_note(a["account_id"], "Possible duplicate: several accounts at this address have "
                                        "billing history, so no survivor was auto-picked.", f"Explain on “{a['name']}”"))
            preconds += self.preconditions_for(a, ["status", "duplicate_of_account"])
        return self._case("duplicate", ["duplicate", "needs_judgment"], f"site:{loc.slug}", loc.name,
                          "Several accounts with billing history at one address: needs a human to pick the survivor",
                          ["More than one duplicate carries billing history, so the survivor isn't chosen automatically."],
                          loc, [self.case_account("duplicate", c.account, c.signals.labels()) for c in lm.matches],
                          [r for c in lm.matches for r in self.evidence(loc, c.account, compact=True)], None, "low", ops, preconds)

    # ---------- account sweep ----------
    def sweep_case(self, a: dict) -> dict:
        subject = f"account:{a['account_id']}"
        others = [o for o in same_address_accounts(a, self.o.pool)
                  if o.get("parent_id") and o.get("parent_id") != self.operator_id]
        addr = f"{a.get('billing_street')}, {a.get('billing_city')} {a.get('billing_state')}"
        if others:
            owner = sorted(others, key=lambda o: (-(o.get("lifetime_revenue") or 0), -len(self.contacts(o["account_id"])),
                                                  o["account_id"]))[0]
            new_parent = self.parent_name(owner)
            chow = rules.sop_requires_chow(a.get("lifetime_revenue"), a.get("outstanding_ar"))
            sop = {"account_id": a["account_id"], "lifetime_revenue": a.get("lifetime_revenue") or 0,
                   "outstanding_ar": a.get("outstanding_ar") or 0, "from_parent": self.operator_name,
                   "to_parent": new_parent, "branch": "chow" if chow else "reparent"}
            reasoning = [f"No longer listed on the {self.operator_name} website.",
                         f"“{owner['name']}” ({owner['account_id']}) under {new_parent} is at the same address ({addr}): "
                         f"the facility now belongs to {new_parent}."]
            preconds = self.preconditions_for(a, ["parent_id", "lifetime_revenue", "outstanding_ar",
                                                  "chow_current_account", "duplicate_of_account", "status"])
            if chow:
                sop["explanation"] = (f"Billing history ({money(a.get('lifetime_revenue'))}) AND open AR "
                                      f"({money(a.get('outstanding_ar'))}): the old account must stay exactly as it is. "
                                      f"{new_parent} already has an account for this facility, so instead of creating "
                                      f"a second one, the old account points to it via chow_current_account.")
                reasoning.append("Billing history and open AR, so per the CHOW SOP the old account is preserved and "
                                 "linked rather than moved.")
                ops = [self.update(a["account_id"], {"chow_current_account": owner["account_id"]},
                                   f"Point “{a['name']}” to {new_parent}'s existing account (chow_current_account); "
                                   f"leave everything else untouched"),
                       self.append_note(owner["account_id"], f"Change of ownership: predecessor account {a['account_id']} "
                                        f"(“{a['name']}”, {self.operator_name}) kept for billing per CHOW SOP and linked here.",
                                        f"Note the predecessor on {new_parent}'s account")]
                kind, tags = "sold", ["sold", "chow"]
            else:
                sop["explanation"] = (f"No open billing to preserve, and {new_parent} already has an account here, so the "
                                      f"old {self.operator_name} record is marked a duplicate of it and set Inactive.")
                ops = [self.update(a["account_id"], {"duplicate_of_account": owner["account_id"], "status": "Inactive"},
                                   f"Mark “{a['name']}” a duplicate of {new_parent}'s account and set it Inactive"),
                       self.append_note(a["account_id"], f"No longer a {self.operator_name} community; now {new_parent} "
                                        f"(account {owner['account_id']}).", "Explain in the note")]
                kind, tags = "sold", ["sold", "duplicate"]
            accounts = [self.case_account("old_record", a), self.case_account("new_owner_record", owner)]
            evidence = self.evidence(None, a, compact=True) + self.evidence(None, owner, compact=True)
            return self._case(kind, tags, subject, a["name"], f"Sold: now {new_parent}", reasoning, None, accounts,
                              evidence, sop, "high", ops, preconds)

        reasoning = [f"Parented to {self.operator_name} in the CRM, but no longer listed on its website.",
                     f"No other CRM account at {addr}, so the new owner (if any) is unknown.",
                     f"Set to {rules.UNLISTED_STATUS} with a note so a rep can confirm; parent left unchanged."]
        ops = [self.update(a["account_id"], {"status": rules.UNLISTED_STATUS},
                           f"Set “{a['name']}” to {rules.UNLISTED_STATUS}"),
               self.append_note(a["account_id"], f"No longer listed on the {self.operator_name} website; no other CRM "
                                f"account at this address, so the current owner is unknown. Needs a rep to confirm.",
                                "Explain in the note")]
        return self._case("unlisted", ["unlisted"], subject, a["name"], "No longer on the website; owner unknown",
                          reasoning, None, [self.case_account("target", a)], self.evidence(None, a), None, "medium",
                          ops, self.preconditions_for(a, ["status", "parent_id", "duplicate_of_account"]))

    # ---------- assembly ----------
    def _case(self, kind, tags, subject, title, summary, reasoning, loc, accounts, evidence, sop, confidence, ops,
              preconds) -> dict:
        tags = list(dict.fromkeys(tags))
        return {"fingerprint": fingerprint(kind, subject, ops), "kind": kind, "tags": tags, "subject_key": subject,
                "title": title, "summary": summary, "reasoning": reasoning,
                "location": loc.to_dict() if loc else None, "accounts": accounts, "evidence": evidence, "sop": sop,
                "confidence": confidence, "operations": ops, "preconditions": self._dedupe(preconds)}

    @staticmethod
    def _dedupe(preconds: list[dict]) -> list[dict]:
        seen, out = set(), []
        for p in preconds:
            k = (p["account_id"], p["field"])
            if k not in seen:
                seen.add(k)
                out.append(p)
        return out

    def _mr(self, subject, loc, cand: Candidate, classification) -> dict:
        return {"subject_key": subject, "name": loc.name, "classification": classification,
                "account_id": cand.account["account_id"], "account_name": cand.account.get("name"),
                "confidence": cand.signals.confidence(), "signals": cand.signals.labels()}

    def _describe_update(self, t: dict, fields: dict, from_parent: str | None) -> str:
        parts = []
        if "parent_id" in fields:
            parts.append(f"move it from {from_parent} to {self.operator_name}")
        if "name" in fields:
            parts.append(f"rename to “{fields['name']}”")
        rest = [FIELD_LABEL[f] for f in fields if f not in ("parent_id", "name", "status")]
        if rest:
            parts.append("update " + ", ".join(rest))
        if fields.get("status") == "Active":
            parts.append("reactivate")
        text = "; ".join(parts)
        return f"On “{t['name']}”: {text}" if text else f"Update “{t['name']}”"

    def _audit_text(self, t, changes, parent_move, losers) -> str:
        bits = []
        if parent_move:
            bits.append(f"re-parented from {self.parent_name(t)} to {self.operator_name}")
        if "name" in changes:
            bits.append(f"renamed from “{t['name']}”")
        other = [FIELD_LABEL[f] for f in changes if f not in ("name", "status")]
        if other:
            bits.append("updated " + ", ".join(other))
        if losers:
            bits.append("survivor of duplicates " + ", ".join(c.account["account_id"] for c in losers))
        return ("Per the operator website: " + "; ".join(bits) + ".") if bits else "Verified against the operator website."

    def _survivor_reason(self, s: Candidate, losers: list[Candidate], loc: Location) -> str:
        """The rule that actually decided it: the first survivor-key position where the survivor beats the runner-up."""
        reasons = ["it carries the billing history", f"already under {self.operator_name}",
                   "its contact is the website's administrator", "its phone matches the website",
                   "it has the most contacts", "its street matches the website exactly",
                   "tie broken by lowest account id (all other rules equal)"]
        mine = self.survivor_key(s, loc)
        runner_up = self.survivor_key(losers[0], loc)
        for i, (x, y) in enumerate(zip(mine, runner_up)):
            if x != y:
                return reasons[i]
        return reasons[-1]

    def _summary(self, kind, tags, t, loc) -> str:
        p = self.parent_name(t)
        return {
            "chow": f"Change of ownership: still under {p} with open AR (SOP: new account + link)",
            "duplicate": f"{1 + tags.count('duplicate')}+ CRM records for one facility" +
                         (f"; survivor also moves from {p}" if "reparent" in tags else "") +
                         ("; renamed" if "rename" in tags and "reparent" in tags else ""),
            "reparent": f"Wrong parent: {p} → {self.operator_name}" + ("; outdated name" if "rename" in tags and "cosmetic" not in tags else ""),
            "rename": "Name cleanup to match the website" if "cosmetic" in tags else f"Outdated name: now “{loc.name}”",
            "field_fix": "Address data differs from the website",
            "reactivate": "Inactive in the CRM but listed live",
        }.get(kind, kind)


def build_cases(outcome: MatchOutcome, today: str, scrape_complete: bool) -> tuple[list[dict], list[dict]]:
    """Returns (cases, match_results). The account sweep only runs on a complete scrape: a page that failed to load
    must not make live communities look 'no longer listed'."""
    b = CaseBuilder(outcome, today)
    cases, results = [], []
    for lm in outcome.by_location:
        case, mr = b.location_case(lm)
        results.append(mr)
        if case:
            cases.append(case)
    if scrape_complete:
        for a in outcome.unmatched_operator_accounts:
            case = b.sweep_case(a)
            cases.append(case)
            results.append({"subject_key": case["subject_key"], "name": a["name"], "classification": "case",
                            "account_id": a["account_id"], "account_name": a["name"], "confidence": case["confidence"],
                            "signals": []})
    return cases, results
