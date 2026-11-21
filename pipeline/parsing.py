"""Pure text-parsing helpers for scraped content (no browser needed, so they're unit-tested directly)."""
from __future__ import annotations

import re
from urllib.parse import urlparse

_CITY_STATE_ZIP = re.compile(r"^\s*(?P<city>.+?),\s*(?P<state>[A-Za-z]{2})\.?\s+(?P<zip>\d{5})(?:-\d{4})?\s*$")
_SLUG_PATH = re.compile(r"^/communities/(?P<slug>[A-Za-z0-9][A-Za-z0-9_-]*)/?$")
_COUNT_CLAIM = re.compile(r"\b(?:serve|operate|proudly serve)\s+(\d{1,4})\s+communities", re.I)
_DIRECTORY_COUNT = re.compile(r"(\d{1,4})\s+communities\s+listed", re.I)


def community_slug(href: str | None) -> str | None:
    """'/communities/bellhaven-of-goshen' or a full URL → 'bellhaven-of-goshen'. Directory/query links → None."""
    if not href:
        return None
    parsed = urlparse(href)
    if parsed.query:
        return None
    m = _SLUG_PATH.match(parsed.path)
    return m.group("slug") if m else None


def parse_address(text: str) -> dict[str, str]:
    """'1800 N Blanchard St\\nFindlay, OH 45840' → street/city/state/zip.

    The last line holding "City, ST 12345" is the locality; everything before it is the street (multi-line safe).
    Raises ValueError when no locality line is found, so bad pages fail loudly instead of producing junk.
    """
    lines = [ln.strip() for ln in re.split(r"[\r\n]+", text or "") if ln.strip()]
    for i in range(len(lines) - 1, -1, -1):
        m = _CITY_STATE_ZIP.match(lines[i])
        if m:
            street = ", ".join(lines[:i]).strip()
            if not street:
                break
            return {"street": street, "city": m["city"].strip(), "state": m["state"].upper(), "zip": m["zip"]}
    raise ValueError(f"Unrecognized address format: {text!r}")


def split_offerings(texts: list[str]) -> list[str]:
    """Clean badge texts; tolerate a single comma/newline-separated blob when there are no badges."""
    out: list[str] = []
    for t in texts:
        for part in re.split(r"[\n,;]+", t or ""):
            part = re.sub(r"\s+", " ", part).strip()
            if part and part not in out:
                out.append(part)
    return out


def claimed_count(page_text: str) -> int | None:
    """Homepage marketing copy, e.g. 'Today we proudly serve 35 communities' → 35."""
    m = _COUNT_CLAIM.search(page_text or "")
    return int(m.group(1)) if m else None


def directory_count(page_text: str) -> int | None:
    """Directory header, e.g. 'Page 1 of 3 · 34 communities listed' → 34."""
    m = _DIRECTORY_COUNT.search(page_text or "")
    return int(m.group(1)) if m else None
