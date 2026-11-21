"""CLI entry point: `python -m pipeline <command>`."""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from .config import REPO_ROOT, get_settings


def cmd_scrape(args: argparse.Namespace) -> int:
    from .scraper import scrape

    locations, report = scrape(get_settings().site_base_url, headless=not args.headed)
    print(f"\n{'NAME':52} {'CITY':16} ST ZIP   OFFERINGS")
    for loc in locations:
        flag = "  [homepage only]" if loc.found_on == ["homepage"] else ""
        print(f"{loc.name[:52]:52} {loc.city[:16]:16} {loc.state} {loc.zip} {', '.join(loc.care_offerings)}{flag}")
    print(f"\nscraped {report.found_count} communities over {report.pages_visited} directory pages "
          f"(homepage claims {report.claimed_count}, directory lists {report.directory_count})")
    for w in report.warnings:
        print(f"  ! {w}")
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({
            "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "report": report.to_dict(),
            "locations": [loc.to_dict() for loc in locations],
        }, indent=2) + "\n", encoding="utf-8")
        print(f"\nwrote {out.relative_to(REPO_ROOT) if out.is_relative_to(REPO_ROOT) else out}")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    from .run import run_pipeline

    s = run_pipeline(trigger=args.trigger, dry_run=args.dry_run, scrape_file=args.scrape_file,
                     headless=not args.headed)
    sc = s["scrape"]
    print(f"\nScrape: {sc['found_count']} communities (homepage claims {sc['claimed_count']}), "
          f"complete={sc['complete']}" + (f", FAILED pages: {sc['failed']}" if sc["failed"] else ""))
    print(f"CRM:    {s['accounts_read']} accounts, {s['contacts_read']} contacts read (read-only)")
    print(f"\n{'KIND':10} {'TAGS':30} {'FACILITY':44} CONF   SUMMARY")
    for c in s["cases"]:
        print(f"{c['kind']:10} {','.join(c['tags'])[:30]:30} {c['title'][:44]:44} {c['confidence']:6} {c['summary'][:70]}")
    kinds = ", ".join(f"{k} {v}" for k, v in sorted(s["cases_by_kind"].items()))
    print(f"\n{s['case_count']} cases ({kinds}); {s['in_sync']} communities already in sync")
    if args.dry_run:
        print("Dry run: nothing saved.")
    else:
        print(f"Saved as run #{s['run_id']}. Queue changes: {s['store']}. Queue now: {s['queue']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252
    parser = argparse.ArgumentParser(prog="python -m pipeline", description="Bellhaven CRM Sync pipeline")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    p_scrape = sub.add_parser("scrape", help="scrape the website only and print what was found")
    p_scrape.add_argument("--out", help="also write the scrape to this JSON file")
    p_scrape.add_argument("--headed", action="store_true", help="show the browser window")
    p_scrape.set_defaults(func=cmd_scrape)

    p_run = sub.add_parser("run", help="full run: scrape, read CRM, match, queue cases for review")
    p_run.add_argument("--dry-run", action="store_true", help="print the cases without saving them")
    p_run.add_argument("--trigger", choices=["manual", "schedule", "ci"], default="manual")
    p_run.add_argument("--scrape-file", help="reuse a saved scrape JSON instead of scraping live")
    p_run.add_argument("--headed", action="store_true", help="show the browser window")
    p_run.set_defaults(func=cmd_run)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("selenium").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
