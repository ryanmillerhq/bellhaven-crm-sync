"""Normalization used for comparison only. The CRM always receives the website's original text."""
from __future__ import annotations

import re

from rapidfuzz import fuzz

from .rules import CARE_TYPE_MAP

# USPS-style suffix and directional abbreviations (both directions collapse to one canonical token).
_STREET_TOKENS = {
    "street": "st", "st": "st", "road": "rd", "rd": "rd", "avenue": "ave", "ave": "ave", "av": "ave",
    "drive": "dr", "dr": "dr", "boulevard": "blvd", "blvd": "blvd", "lane": "ln", "ln": "ln", "pike": "pike",
    "pk": "pike", "court": "ct", "ct": "ct", "place": "pl", "pl": "pl", "parkway": "pkwy", "pkwy": "pkwy",
    "highway": "hwy", "hwy": "hwy", "circle": "cir", "cir": "cir", "terrace": "ter", "ter": "ter",
    "square": "sq", "sq": "sq", "way": "way",
    "north": "n", "n": "n", "south": "s", "s": "s", "east": "e", "e": "e", "west": "w", "w": "w",
    "northwest": "nw", "nw": "nw", "northeast": "ne", "ne": "ne", "southwest": "sw", "sw": "sw",
    "southeast": "se", "se": "se",
}
_UNIT = re.compile(r"\b(suite|ste|unit|apt|#)\s*[\w-]+", re.I)
_PO_BOX = re.compile(r"^\s*p\.?\s*o\.?\s*box\b", re.I)


def street_key(street: str | None) -> str:
    """'1125 Logan Boulevard' and '1125 Logan Blvd.' → '1125 logan blvd'. Units/suites are dropped."""
    s = _UNIT.sub(" ", (street or "").lower())
    tokens = re.sub(r"[^a-z0-9 ]", " ", s).split()
    return " ".join(_STREET_TOKENS.get(t, t) for t in tokens)


def is_po_box(street: str | None) -> bool:
    return bool(_PO_BOX.match(street or ""))


def name_key(name: str | None) -> str:
    """For similarity only: 'The Arbors at Bellhaven - Dayton' → 'arbors bellhaven dayton'."""
    s = (name or "").lower().replace("&", " and ")
    s = re.sub(r"\bhealth\s+care\b", "healthcare", s)
    s = re.sub(r"\brehab\b", "rehabilitation", s)
    s = re.sub(r"\bcentre\b", "center", s)
    tokens = [t for t in re.sub(r"[^a-z0-9 ]", " ", s).split() if t not in {"the", "of", "at"}]
    return " ".join(tokens)


def name_similarity(a: str | None, b: str | None, drop: frozenset[str] = frozenset()) -> int:
    """0–100. token_sort (not token_set) so 'Bellhaven of Carlisle' doesn't score 100 against '...of New Carlisle'.
    `drop` removes non-distinguishing words (the operator's brand) so shared branding can't inflate a score."""
    ka = " ".join(t for t in name_key(a).split() if t not in drop)
    kb = " ".join(t for t in name_key(b).split() if t not in drop)
    if not ka or not kb:
        return 0
    return round(fuzz.token_sort_ratio(ka, kb))


def phone_key(phone: str | None) -> str:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:] if len(digits) >= 10 else ""


def person_key(name: str | None) -> str:
    return re.sub(r"[^a-z]", "", (name or "").lower())


def care_types(offerings: list[str]) -> list[str]:
    """Website offerings → CRM care_type vocabulary, in website order, deduped."""
    out: list[str] = []
    for o in offerings:
        mapped = CARE_TYPE_MAP.get(re.sub(r"\s+", " ", o.strip().lower()))
        if mapped and mapped not in out:
            out.append(mapped)
    return out


def parent_display(name: str | None) -> str:
    return re.sub(r"\s*\(parent account\)\s*$", "", name or "", flags=re.I).strip()
