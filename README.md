# Bellhaven CRM Sync

Keeps facility → parent-company ownership accurate in a CRM. A daily pipeline scrapes an operator's website
(Bellhaven Senior Living, a fictional operator), matches every community to CRM accounts, and queues one
**review case** per facility, with evidence. A reviewer approves or rejects each case in a small web app, and
**only approved changes are written back to the CRM.**

Built for the Clipboard Health Sales Operations Analyst exercise ([original instructions](docs/project-instructions-page.txt)).

```
 website ──► Selenium scraper ─┐
                               ├─► matcher ─► case builder ─► review store (Supabase) ─► review app ─► CRM API
 CRM (read-only GETs) ─────────┘     (rules.py)  (CHOW SOP,          ▲  idempotent        (one case at   (writes only
                                                  duplicates)        │  by fingerprint     a time)        after approval)
                                    GitHub Actions, daily ───────────┘
```

## What it handles
| Situation | What the case does (one click after review) |
|---|---|
| Confident match | Nothing to change; listed under **In sync** |
| Wrong parent, no billing to protect | Re-parents the existing account (plus any field fixes) |
| Wrong parent **with** billing history AND open AR | **CHOW SOP:** creates a new account under the right parent, sets `chow_current_account` on the old one, and leaves the old one otherwise untouched |
| Outdated name / address error | Renames to the website's name (rebrands and cosmetic fixes are tagged separately) / fixes the field |
| Several CRM records for one facility | Picks a survivor by an explicit rule; losers get `duplicate_of_account` + Inactive, and their contacts move to the survivor |
| Community missing from the CRM | Creates it under Bellhaven (name-lookalikes elsewhere are shown and explained, never matched) |
| Bellhaven account gone from the website, new owner's account at the same address | Treated as sold: CHOW-links to the new owner's record (or marks a duplicate if there's no billing to protect) |
| Bellhaven account gone from the website, owner unknown | `Needs Review` + an explanatory note |

The matching logic and every judgment call are written up in [docs/matching-outline.md](docs/matching-outline.md),
which Ryan approved before any matching code was written. All thresholds and policies live in
[pipeline/rules.py](pipeline/rules.py).

## Safety properties
- **The pipeline cannot write to the CRM.** Its client ([pipeline/crm.py](pipeline/crm.py)) has GET methods only.
  Writes happen only in the review app's executor, after a human approves a case.
- **Re-runs are safe.** Each case has a fingerprint of the change it would make. Approved or rejected
  fingerprints are never proposed again, and approved changes simply stop appearing because the CRM now matches.
  See [pipeline/store.py](pipeline/store.py) and the lifecycle tests.
- **The executor re-checks the CRM before writing.** If a precondition drifted (parent, revenue/AR, status), the
  case goes stale instead of writing. Notes are appended, never overwritten.
- **Incomplete scrapes can't do damage.** If any page fails, or the count falls short of the homepage's own claim,
  the "no longer listed" sweep and superseding are switched off for that run.
- **Audit trail.** Every proposal, refresh, decision and write is recorded in `case_events`, with who and how
  (UI or MCP).

## Run it
```bash
python -m venv .venv && .venv/Scripts/activate      # (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
cp .env.example .env                                 # add CRM_API_TOKEN and DATABASE_URL

python -m pipeline scrape                            # scrape only, print the 35 communities
python -m pipeline run --dry-run                     # full match, print the cases, save nothing
python -m pipeline run                               # save cases to the review store
pytest                                               # 55 tests: parsers, matching, SOP table, idempotency, lifecycle
```
Database: run [db/migrations/](db/migrations/) in the Supabase SQL editor once.
Daily schedule: [.github/workflows/daily-sync.yml](.github/workflows/daily-sync.yml), which also has the
equivalent crontab line.

## Repo map
| Path | What |
|---|---|
| `pipeline/` | Scraper (`scraper.py`, `xpaths.py`), CRM client, matcher (`match.py`), case builder (`proposals.py`), store, CLI |
| `web/` | Review app (Next.js): one case at a time, evidence, approve/reject, executor |
| `db/migrations/` | Review-store schema (runs, cases, case_events) |
| `data/` | Committed website scrape and the pre-change CRM snapshot (for before/after diffs and tests) |
| `docs/` | [Plan](docs/PLAN.md), [matching outline](docs/matching-outline.md), [case contract](docs/case-contract.md), [writeup](docs/writeup.md), [initial prompt](docs/initial-prompt.md), [every prompt verbatim](docs/prompts-log.md) |
| `.claude/` | The AI tooling used: prompt-logging hook, writeup agent definition |

## How AI was used
Built with Claude Code, directed by Ryan. Every prompt Ryan gave is in [docs/prompts-log.md](docs/prompts-log.md),
word for word. The approach: plan first, review gates before core logic (the matching outline), an adversarial
agent review of the matching logic, and tests run against the real data.
