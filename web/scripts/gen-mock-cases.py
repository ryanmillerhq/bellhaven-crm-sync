"""Regenerate web/lib/mock/pipeline-cases.json from the REAL pipeline (pipeline.match + pipeline.proposals),
run on the committed scrape and pre-change CRM snapshot. Mock mode then shows exactly what production shows.

Usage (from the repo root):  .venv/Scripts/python web/scripts/gen-mock-cases.py
Reads data/ only; writes nothing but the JSON file. No network, no CRM, no database.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PIPELINE_ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO  # optional: another checkout's pipeline
sys.path.insert(0, str(PIPELINE_ROOT))

from pipeline.match import match  # noqa: E402
from pipeline.models import Location  # noqa: E402
from pipeline.proposals import build_cases  # noqa: E402

data = REPO / "data"
scrape = json.loads((data / "scrapes" / "2026-11-21.json").read_text(encoding="utf-8"))
accounts = json.loads((data / "crm-snapshot-before" / "accounts.json").read_text(encoding="utf-8"))
contacts = json.loads((data / "crm-snapshot-before" / "contacts.json").read_text(encoding="utf-8"))
locations = [Location(**loc) for loc in scrape["locations"]]

outcome = match(locations, accounts, contacts)
cases, match_results = build_cases(outcome, today="2026-11-21", scrape_complete=True)

out = REPO / "web" / "lib" / "mock" / "pipeline-cases.json"
out.write_text(json.dumps({"generated_from": "pipeline.proposals.build_cases on data/ (2026-11-21)",
                           "cases": cases, "match_results": match_results}, indent=1) + "\n", encoding="utf-8")
print(f"wrote {out.relative_to(REPO)}: {len(cases)} cases, {len(match_results)} match results")
