"""Plain data records shared across the pipeline."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Location:
    """One community as published on the operator's website (the source of truth for what Bellhaven runs)."""

    slug: str
    url: str
    name: str
    street: str
    city: str
    state: str
    zip: str
    care_offerings: list[str]
    administrator: str = ""
    phone: str = ""
    # Where the scraper found the link: "directory p1", "directory p2", "homepage", ...
    found_on: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ScrapeReport:
    """Validation facts about a scrape, surfaced in the run summary so silent misses are visible."""

    claimed_count: int | None  # e.g. homepage says "35 communities"
    directory_count: int | None  # e.g. directory header says "34 communities listed"
    found_count: int
    pages_visited: int
    homepage_only: list[str]  # slugs linked from the homepage but missing from the directory
    warnings: list[str] = field(default_factory=list)  # worth a look, but the scrape is still usable
    failed: list[str] = field(default_factory=list)  # detail pages that could not be read

    @property
    def complete(self) -> bool:
        """Safe to conclude 'not on the website' from absence? Only if every page loaded and the count adds up."""
        return (self.found_count > 0 and not self.failed
                and (self.claimed_count is None or self.found_count >= self.claimed_count))

    def to_dict(self) -> dict:
        return {**asdict(self), "complete": self.complete}

    @classmethod
    def from_dict(cls, d: dict) -> "ScrapeReport":
        return cls(**{k: d.get(k) for k in ("claimed_count", "directory_count", "found_count", "pages_visited",
                                            "homepage_only")}, warnings=d.get("warnings") or [],
                   failed=d.get("failed") or [])
