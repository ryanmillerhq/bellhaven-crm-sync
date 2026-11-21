"""Every XPath the scraper uses, in one place.

They're written to survive cosmetic site changes. Fields are anchored on their visible *labels* (case-insensitive),
not on position or styling. Links are found by URL shape, not card markup. If the site changes, this is usually the
only file to touch.
"""

_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_LOWER = "abcdefghijklmnopqrstuvwxyz"


def _lower(expr: str) -> str:
    """XPath 1.0 has no lower-case(); translate() is the portable equivalent."""
    return f"translate(normalize-space({expr}), '{_UPPER}', '{_LOWER}')"


XPATH = {
    # Any anchor pointing at a community detail page: directory cards, homepage notices, anywhere on a page.
    "community_links": "//a[contains(@href, '/communities/')]",
    # Pagination control: rel=next, or any link whose text says "next" (e.g. "Next →").
    "next_page": f"//a[@rel='next' or contains({_lower('.')}, 'next')]",
    # Free-text spots that state counts ("Page 1 of 3 · 34 communities listed", "serve 35 communities").
    "body_text": "//body",
    # Detail page: the community name is the page's main heading.
    "detail_name": "(//h1)[1]",
    # Detail page: the value cell that follows a label cell containing `{label}` (address, care, phone, ...).
    "detail_field": f"//dt[contains({_lower('.')}, '{{label}}')]/following-sibling::dd[1]",
    # Within a field: individual chips/badges (care offerings).
    "badges": ".//*[contains(@class, 'badge')]",
}

# Label keywords tried in order for each detail field (first match wins).
FIELD_LABELS = {
    "address": ["address", "location"],
    "care": ["care offering", "care", "services", "levels of care"],
    "administrator": ["administrator", "executive director", "director"],
    "phone": ["phone", "telephone", "call"],
}
