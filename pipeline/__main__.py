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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pipeline", description="Bellhaven CRM Sync pipeline")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    p_scrape = sub.add_parser("scrape", help="scrape the website only and print what was found")
    p_scrape.add_argument("--out", help="also write the scrape to this JSON file")
    p_scrape.add_argument("--headed", action="store_true", help="show the browser window")
    p_scrape.set_defaults(func=cmd_scrape)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("selenium").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
