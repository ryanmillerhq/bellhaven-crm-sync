"""One pipeline run: scrape → read CRM → match → build cases → save to the review store (unless dry run)."""
from __future__ import annotations

import json
import logging
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .config import get_settings
from .crm import ReadOnlyCRM
from .match import match
from .models import Location, ScrapeReport
from .proposals import build_cases

log = logging.getLogger(__name__)


def load_scrape(path: str | Path) -> tuple[list[Location], ScrapeReport]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return [Location(**loc) for loc in data["locations"]], ScrapeReport.from_dict(data["report"])


def run_pipeline(*, trigger: str = "manual", dry_run: bool = False, scrape_file: str | None = None,
                 headless: bool = True) -> dict:
    settings = get_settings()
    today = datetime.now(timezone.utc).date().isoformat()
    store = None
    run_id = None
    if not dry_run:
        from .store import Store
        store = Store(settings.database_url)
        run_id = store.start_run(trigger)
    try:
        if scrape_file:
            locations, report = load_scrape(scrape_file)
        else:
            from .scraper import scrape
            locations, report = scrape(settings.site_base_url, headless=headless)
        crm = ReadOnlyCRM(settings.crm_base_url, settings.crm_api_token)
        accounts, contacts = crm.accounts(), crm.contacts()

        outcome = match(locations, accounts, contacts)
        cases, match_results = build_cases(outcome, today, scrape_complete=report.complete)
        summary = {
            "scrape": report.to_dict(),
            "cases_by_kind": dict(Counter(c["kind"] for c in cases)),
            "case_count": len(cases),
            "in_sync": sum(1 for m in match_results if m["classification"] == "in_sync"),
            "accounts_read": len(accounts),
            "contacts_read": len(contacts),
        }
        if store:
            summary["store"] = store.sync_cases(run_id, cases, allow_supersede=report.complete)
            store.finish_run(run_id, status="succeeded", summary=summary,
                             scrape_snapshot=[loc.to_dict() for loc in locations], match_results=match_results,
                             location_count=len(locations), account_count=len(accounts))
            summary["queue"] = store.status_counts()
        summary["run_id"] = run_id
        summary["cases"] = cases
        _github_summary(summary, dry_run)
        return summary
    except Exception as exc:
        if store and run_id:
            store.finish_run(run_id, status="failed", summary={}, scrape_snapshot=None, match_results=None,
                             location_count=None, account_count=None, error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        if store:
            store.close()


def _github_summary(summary: dict, dry_run: bool) -> None:
    """Writes a short Markdown report to the Actions job page when running in GitHub Actions."""
    path = os.getenv("GITHUB_STEP_SUMMARY")
    if not path:
        return
    title = "(dry run)" if dry_run else "run #" + str(summary.get("run_id"))
    lines = [f"## Bellhaven sync {title}",
             f"- Scraped **{summary['scrape']['found_count']}** communities "
             f"(homepage claims {summary['scrape']['claimed_count']}); complete: {summary['scrape']['complete']}",
             f"- CRM: {summary['accounts_read']} accounts, {summary['contacts_read']} contacts",
             f"- Cases: **{summary['case_count']}** ({', '.join(f'{k} {v}' for k, v in summary['cases_by_kind'].items())}); "
             f"in sync: {summary['in_sync']}"]
    if "store" in summary:
        lines.append(f"- Queue changes: {summary['store']}")
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
