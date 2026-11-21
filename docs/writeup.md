# Writeup: Bellhaven CRM Sync

> **Status: draft 3 (2026-11-21).** Built so far: the scraper (first snapshot of 35 communities committed), a
> read-only CRM snapshot (121 accounts, 67 contacts), and the review-store migration. The matching outline is
> drafted and awaiting Ryan's corrections. The matcher, review app and MCP server aren't built yet. Anything
> described from [PLAN.md](PLAN.md) is marked "planned" or carries a `[[TODO: confirm once built]]`.
> Every `[[TODO: …]]` must be resolved before submitting (search for `[[TODO`). Maintained by the writeup agent
> ([.claude/agents/writeup.md](../.claude/agents/writeup.md)).

---

## Part 1: Submission text

This is paste-ready for the form's "Writeup" field (placeholder: "Half a page is plenty"). Target length is
300–380 words, and it's plain-text safe: no tables, no bold, only simple dashes. Copy everything between the
BEGIN and END markers.

Other form fields (not part of the writeup):
- Repo: https://github.com/ryanmillerhq/bellhaven-crm-sync
- Demo video: `[[TODO: Loom / unlisted YouTube / Drive link, sharing set to anyone with the link]]`
- Actual time spent: `[[TODO: Ryan to fill honest hours]]`

Current length: see the note under the END marker. `[[TODO: re-count after filling; keep under 380.]]`

<!-- BEGIN SUBMISSION TEXT -->

Matching approach

[[TODO, ~30 words: how each website location is linked to a CRM account (signals, normalization, scoring, thresholds), including how it finds Amberly Manor (no "Bellhaven" in its name) and accounts still under Harborview Care Group or Cedar Trail. Source: docs/matching-outline.md once Ryan approves it.]]

[[TODO, ~45 words, one dash per outcome and what it proposes: confident match (no write); needs fix (wrong parent, outdated name or address); no CRM account (create under Bellhaven); under Bellhaven but gone from the website (which status, what note); duplicates (losing copy gets duplicate_of_account + Inactive; how the survivor is chosen).]]

CHOW SOP: if an account needing a new parent has lifetime revenue and outstanding AR above zero, the case creates a new account under the correct parent and sets chow_current_account on the untouched old one. Otherwise it re-parents directly. [[TODO: confirm against the built rule and its tests.]]

Nothing writes without approval. The pipeline only reads the CRM, the review app's executor re-checks it before each approved write, and fingerprinted cases are never re-proposed once decided. [[TODO: confirm once built.]]

How I used AI tools

I used Claude Code (Opus 5.5), and every prompt is in docs/prompts-log.md, verbatim. It wrote the code ([[TODO: final list]]), and a separate agent drafted this writeup. My calls: plan before building; Selenium with flexible XPaths and robust pagination (out-of-range page URLs repeat the last page, so follow "Next"); no human-like scraping (no bot detection); one review case per screen, with the rules applied in one click; and a matching outline for me to correct before any matcher code. [[TODO: my corrections, with prompt numbers, ~12 words.]] I verified with [[TODO, ~20 words: pytest on parsers, the SOP table and idempotency; a dry run checked by hand; scrape count equal to the homepage's 35; end state diffed via the API and the CRM browser; a second run with 0 new proposals]].

What I'd build next

- MCP server (prototype, demoable locally): Claude works cases via the review app's own API, so writes share the UI's executor, CHOW/duplicate logic and audit trail, and Claude Code's permission prompt keeps a human on each write. Next, Claude triages the daily queue and pre-drafts decisions to confirm. [[TODO: confirm once built.]]
- Beyond one website: per-operator config and daily diffs, plus CMS change-of-ownership and state licensing data to catch a CHOW before the website shows it.
- Decision-maker contacts: RocketReach enrichment plus LinkedIn (my human_simulator.py handles sources that resist automation), in a contacts table linked to accounts, with the account owner alerted on each CHOW.

<!-- END SUBMISSION TEXT -->

Length note: 261 words written, plus the TODO targets (30 + 45 matching, ~8 final list, ~12 corrections, ~20
verification), ≈ 376 total. That leaves almost no slack. If a filled TODO runs over, shorten the contacts bullet
first and keep the MCP bullet whole. The full set of ideas, including the map dashboard, pipeline-tracking page
and gamified review, is in the roadmap in Part 2. The map is the natural swap-in if Ryan would rather show it
than the contacts bullet (~20 words: "A zoomable US map of every account, colored by status or parent group,
with cases resolvable from the hover card.").

`[[TODO: refresh "How I used AI tools" from docs/prompts-log.md at the very end. It currently reflects prompts 1–10.]]`

---

## Part 2: Extended notes

These notes are for the README and the live walkthrough.

### Run results

`[[TODO: fill from real run output. Do not estimate.]]`

| Measure | Result |
|---|---|
| Communities scraped | 35, matching the homepage's claim: 34 from the directory (3 pages) plus Bellhaven Meadows of Findlay, which is linked only from the homepage (`data/scrapes/2026-11-21.json`). `[[TODO: update if the final run differs]]` |
| CRM before any change | 121 accounts and 67 contacts, snapshotted read-only in `data/crm-snapshot-before/` |
| CRM accounts considered by the matcher | `[[TODO]]` |
| Cases by kind | `[[TODO: CHOW / re-parent / update / create / duplicate / orphan; plus confident matches shown as "In sync"]]` |
| Approved / rejected | `[[TODO]]` (and how many via the MCP, if any) |
| CHOW cases (new account + `chow_current_account`) vs. direct re-parents | `[[TODO]]` |
| Re-run check | `[[TODO: second run created N new proposals (expected 0)]]` |
| End-state check | `[[TODO: result of diffing every touched account via the API against the expected outcome]]` |

### Architecture (planned)

`[[TODO: confirm once built.]]`

```
pipeline/ (Python)         scrape (Selenium) -> fetch CRM (GET only) -> match -> cases -> Postgres
web/ (Next.js)             one case at a time -> approve -> executor (re-validate, run ops, record) -> CRM API
mcp_server/ (Python)       Claude -> review app's /api/cases -> the same executor
Supabase Postgres          runs, cases, decisions, results: the shared memory that makes re-runs safe
.github/workflows/         daily-sync.yml runs the pipeline (proposes only, never writes)
```

### Matching approach (detail)

`[[TODO: full description from docs/matching-outline.md after Ryan's corrections. Cover candidate generation,
signals and weights, thresholds, the classification tree, the duplicate survivor rule, orphan handling, and the
SOP branch. Note that the rules live in one readable RULES block in pipeline/match.py, for the live change.]]`

Signals planned before the gate (PLAN.md, phase 4) are normalized street and number, zip, city/state, name
similarity after stripping brand words, and phone where present. They may change in the outline.

The matching has to respect these constraints, which are already known from the site and the brief:
- *Amberly Manor* (Hudson, OH) has no "Bellhaven" in its name, so a name search for "bellhaven" alone misses it.
- Bellhaven acquired **Harborview Care Group** (2025) and only **select** Cedar Trail communities (2026). Some
  accounts may still sit under those parents, but not every Cedar Trail facility moved.
- The CRM has 121 accounts and, per the exercise, some are stale, duplicated or mislabeled. Bellhaven has 29
  children, Harborview 5 and Cedar Trail 5. Other parents (Juniper Point, Stonebridge, Millstone) are in the
  mix, and 20 facilities have no parent.
- The CRM contains decoys:
  - "Amberly Manor" in the CRM is a Juniper Point account in Colorado Springs, not the Hudson, OH community.
  - "Union Square Senior Living" (240 Market St) is not Bellhaven at Union Square (118 Union Square Dr).
- The care-type vocabulary differs. The site's "Short-Term Rehabilitation & Nursing" is the CRM's "Skilled
  Nursing", and "Memory Support" is "Memory Care".
- The website detail page is the source of truth for address and care offerings. Its address field is
  `street<br>City, ST ZIP`.

### Decisions

Rows marked "planned" come from PLAN.md and need confirming once built.

| Decision | Choice | Why | Source |
|---|---|---|---|
| Human gate | Nothing writes to the CRM without an explicit approval | Required by the exercise. A wrong parent link misroutes sales outreach and contract sign-off | Exercise |
| One write path (planned) | The pipeline's CRM client exposes GET only. The only write path is the review app's executor, reached through an approved case, and the UI and the MCP share it | A matching bug can at worst produce a bad proposal, never a bad write | PLAN.md |
| Shared store | Supabase Postgres holds runs, cases, decisions and results | One memory shared by the scheduled run, the local app and the hosted app | Ryan (PLAN.md) |
| Re-run idempotency (planned) | Each case gets `fingerprint = sha256(kind \| subject \| canonical desired values)`. Fingerprints already applied or rejected are skipped. Pending ones get fresh evidence, not a duplicate row. Pending ones that a run no longer generates (fixed outside the app) become `superseded` | Never re-proposes a decided item. A genuinely new change, such as a second rename, gets a new fingerprint, so it still surfaces even if an older proposal was rejected | PLAN.md |
| Executor safety (planned) | An atomic claim (`pending` → `applying`) means a double-click can't write twice. The executor re-fetches the accounts and checks preconditions, and marks the case `stale` if the CRM drifted. Ops run in order, and a partial CHOW (create succeeded, link failed) retries without re-creating the account. Notes are appended with a dated `[bellhaven-sync]` line, never overwritten | The API has no merge or delete, so a write has to be right the first time and must never clobber what reps wrote | PLAN.md |
| Review UX | One case per screen with all the context needed to decide. Simple buttons, plus input boxes to adjust the fields being changed. The app executes the duplicate and CHOW rules, and the reviewer checks the reasoning and confirms with one click. Progress by category is always visible | Fast, consistent reviews. The SOP is applied the same way every time instead of depending on the reviewer remembering it | Ryan, prompt 3 |
| Motion | Light, tasteful motion on hovers, case paging and decision feedback (see the design notes) | Makes the app feel modern rather than static without slowing review | Ryan, prompt 4 |
| Matching built outline-first | The AI outlines the matching structure and logic, I correct it, and only then is it implemented | Matching is the judgment-heavy part, and it has to stay readable for the live change | Ryan, prompt 1 |
| Scraper (built) | Selenium with label-anchored, case-insensitive XPaths over each community's detail page, with the parsing kept in pure, testable helpers | My call. The detail page holds the address, care offerings, administrator and phone, and anchoring on labels survives small layout changes | Ryan, prompt 2; `pipeline/scraper.py` |
| Pagination (built) | Follow the "Next →" link, dedupe by slug, stop when a page adds no new communities, and cap the page count | An out-of-range `?page=N` returns the last page again, so a page-number loop never sees an empty page | Prompt 2 left the choice to robustness; `pipeline/scraper.py` |
| Coverage (built) | Also harvest community links from the homepage, and report the total against the homepage's "35 communities" | The directory lists 34. The 35th appears only in the homepage's "New this year" notice. The first run found 35 of 35 | Site check; `data/scrapes/2026-11-21.json` |
| No test records in the CRM | The only CRM writes are approved proposals. Nothing gets created "to try it out" | The CRM's end state is what gets graded | Ryan's working rules (CLAUDE.md) |
| Pre-change snapshot (built) | All accounts and contacts were captured read-only before any write | The end state can be diffed against the starting state, which also gives a record of exactly what changed | `data/crm-snapshot-before/` |
| No human-like scraping | Plain Selenium | The site has no bot detection, and evasion adds complexity for no gain. The capability exists for future sources (see roadmap) | Ryan, prompt 1 |
| Secrets and hosting (planned) | The token lives only in a gitignored `.env` and server-side env vars. The hosted app on Vercel is public to view, but approve and reject need a passcode (signed httpOnly cookie). The CRM-browser link, which embeds the token, is served only through a server-side redirect for signed-in sessions. The prompt-log hook redacts the token, and I removed it from the exercise page before sharing the page with the AI | Public repo, public app | Ryan, prompt 1; PLAN.md |
| Schedule (planned) | `.github/workflows/daily-sync.yml`: `cron: "0 11 * * *"` plus manual dispatch, a concurrency group, and secrets for the token and the database URL. It runs the pipeline, which only proposes. State persists in Postgres between runs | Required by the exercise. Making it live means adding the repo secrets, which is Ryan's call | PLAN.md |
| Duplicate survivor | `[[TODO]]`. The loser gets `duplicate_of_account` = survivor, `status` = Inactive, and a note | `[[TODO]]` | `[[TODO: outline]]` |
| Status / note usage per outcome | `[[TODO: which status and note text for each kind]]`. Notes are always appended, never overwritten (planned) | `[[TODO]]` | `[[TODO: outline]]` |
| Under Bellhaven but not on the website | `[[TODO]]`. The plan leans toward Needs Review plus a note, or a re-parent if the data shows the new owner. To be decided in the outline | `[[TODO]]` | `[[TODO: outline]]` |
| Missing location, so create | A new account under the Bellhaven parent with the website data (planned). `[[TODO: exact fields and status]]` | `[[TODO]]` | `[[TODO: outline]]` |
| CHOW cases | Draft: a new account under Bellhaven with the website data, then `chow_current_account` on the old account, which is otherwise untouched. The SOP table is tested at revenue/AR >0/>0, >0/0, 0/>0 and null (planned) | `[[TODO]]` | `[[TODO: outline]]` |

**Open questions for the matching outline.** These are listed for Ryan to decide, not answered here:
- The SOP says to leave the old account "exactly as it is". The plan's draft writes only `chow_current_account`
  to it. Confirm that this means no appended note on the old account, with the explanation going on the new one.
- What status does the new CHOW account get, and which website fields does it carry (care offerings)?
- Null `lifetime_revenue` or `outstanding_ar`: treat it as zero (direct re-parent), or route the case to
  Needs Review?
- If a facility is both duplicated and needs a new parent, which is resolved first, and on which copy does the
  CHOW check run?

**Re-run traps the matcher must handle.** The fingerprint design stops the same change from being re-proposed.
These two cases are matching logic and need explicit handling:
- After a CHOW, the old and new accounts both describe the same facility. The next run must follow
  `chow_current_account` rather than flag the pair as duplicates or propose a second CHOW.
- Accounts already marked Inactive with `duplicate_of_account` set must not be re-proposed or picked as survivors.

### Review app design notes (planned)

`[[TODO: confirm once built; trim anything that didn't ship.]]`
- **Progress header:** a ring for decided/total, a bar segmented by case kind (CHOW, re-parent, update, create,
  duplicate, orphan), and Pending/Approved/Rejected counts.
- **Case card, one at a time** ("Case 4 of 12", with a kind badge and a confidence meter):
  1. *What we found*: 2–4 plain-English reasoning bullets.
  2. *Evidence*: website vs. CRM side by side, field by field.
  3. *SOP check* (parent moves only): the revenue and AR values, which branch applies, and why, in one sentence.
     This shows a reviewer why a >0/0 case is a direct re-parent and not a CHOW.
  4. *What will happen*: numbered steps for the exact API ops, with pre-filled inputs for the editable values.
  5. Approve (runs the whole duplicate/CHOW sequence) · Reject (optional reason) · Skip. Keyboard: A / R / →.
- **Approve with a 5-second undo** window before the write fires.
- **Secondary tabs:** History (decided cases, results, reopen), In sync (confident matches, as proof of
  coverage), Runs.
- **Motion** (my direction, prompt 4): light and tasteful, never in the way.
  - Cases slide in the direction of travel.
  - Cards lift slightly on hover, and buttons compress on press.
  - Decisions get feedback: a check morph and a soft green flash on approve, a dimmed card on reject, and the
    progress ring animating forward.
  - Evidence rows fade in with a short stagger.
  - There's no confetti, and everything respects the OS reduced-motion setting.
- **Look:** borrowed from my zenith-web-app (theme tokens, Geist, shadcn components, lordicons), with a Lordicon
  credit in the footer.

### Known limitations

`[[TODO: confirm each one against the final build, and add anything the CRM exploration turns up.]]`
- The operator's own website is the only ownership signal. If the site is stale or wrong, the CRM inherits the
  error (roadmap item 5).
- The scraper's selectors are specific to this site's HTML. Its report (count against the homepage claim, missing
  fields) only warns today and doesn't stop the run (roadmap item 2). `[[TODO: re-check once the pipeline CLI
  wires scrape → match.]]`
- The API has no delete or merge. Undo exists only during the 5-second window before a write fires. After that,
  a mistakenly created account can only be marked Inactive.
- There's one shared passcode, not per-user accounts. Decisions are recorded (when, note, result, UI vs. MCP),
  but not by named reviewer.
- The scraper captures each community's administrator and phone, and the CRM has a contacts resource (67 contacts).
  `[[TODO: does this version write or update contacts, or only use them as match evidence?]]`
- `[[TODO: the MCP prototype runs locally only?]]`

### Prompt-log highlights (how I directed the AI)

`[[TODO: extend with every later prompt, especially corrections to the AI's output and checks I made it run.]]`

| Prompt | What I directed | Effect on the build |
|---|---|---|
| 1 | Plan thoroughly before starting, and read the instructions as closely as I had ("a few complexities and intricacies") | A project brief (CLAUDE.md) recording the site's traps and the CHOW SOP, and a phased plan (PLAN.md), both before any code |
| 1 | Outline the matching logic for my correction before going deeper | A hard gate in the plan (phase 4). `[[TODO: outline doc + what I changed]]` |
| 1 | No human-like scraper, but note the capability for future sources | Plain Selenium. The capability is noted in the roadmap |
| 1 | Removed my API token from the page myself, and asked for a `.env` | Token kept out of the shared page and the public repo |
| 1 | Verbatim prompt log, a separate writeup agent, a UI based on my zenith-web-app (with lordicons), hosting on Vercel | `docs/prompts-log.md` via a hook; this document. I created the Vercel project, connected to the repo, at https://bellhaven-crm-sync.vercel.app/ (prompt 8). `[[TODO: review app UI, app deployed]]` |
| 2 | Selenium navigation, a flexible XPath per community page, and pagination by URL or buttons, whichever is more robust | Follow-"Next" pagination, because an out-of-range `?page=N` repeats the last page. `[[TODO: confirm built]]` |
| 3 | Review app: intuitive, one case at a time with all the context on one screen, simple buttons and inputs, the duplicate and CHOW logic as one-click confirmation, strong progress visuals | The case card and progress header in the design notes. `[[TODO: confirm built]]` |
| 4 | An MCP server so I can connect Claude directly to the review app to pull data and perform ops, demoed locally; light, tasteful animations | The MCP prototype (plan phase 10) leads "What I'd build next", and the motion spec is in the design notes. `[[TODO: confirm built]]` |
| 7 | Small, segmented, well-described commits throughout | The git history documents the build step by step: one concern per commit, with conventional prefixes |
| 9 | Put any Supabase migrations in a `_run-me` folder for me to run | I apply database schema changes myself. The first migration covers runs, cases and case events |
| 10 | More "what next" ideas: contact enrichment (LinkedIn, RocketReach, a separate contacts table), a pipeline-tracking page, a US map dashboard with hover-card resolution, and gamified review | Roadmap items 3, 8, 9 and 12 |

### What I'd build next: roadmap sketch

Effort assumes one person who already knows this codebase, and the numbers are rough. Value is judged against
the problem Clipboard described: ownership changes constantly, and the parent link decides who signs and who
sales calls. The MCP server leads. Everything else is grouped by what it improves.

| # | Theme | Item | Effort | Value |
|---|---|---|---|---|
| 1 | Lead | MCP server for the review app (prototype built) | Prototype ~0.5–1 day; triage/pre-drafting 1–2 days; hosted multi-user ~1 week | High |
| 2 | Trust the daily run | Scrape health guard | ~0.5 day | High |
| 3 | Trust the daily run | Pipeline tracking page | ~0.5–1 day | Medium |
| 4 | Trust the daily run | Snapshot diffs and ownership timeline | 1–2 days | High |
| 5 | Better ownership signals | Independent ownership data (CMS, state licensure) | CMS 2–3 days; states ~1 day each | High |
| 6 | Better ownership signals | Multi-operator site adapters | 2–3 days for the framework, then hours per typical site | High |
| 7 | Better ownership signals | Acquisition-aware sweeps | ~1 day on top of 4 and 6 | Medium–high |
| 8 | Put it in front of sales | Decision-maker contacts and enrichment | ~2 days; LinkedIn path +2–3 days after sign-off | High |
| 9 | Put it in front of sales | Account map dashboard | 1–2 days | Medium–high |
| 10 | Scale the review | Learn from review decisions | 1–2 days, after a few weeks of decisions | Medium now, high at scale |
| 11 | Scale the review | Reviewer workflow: identity, assignment, Slack, audit view | 2–3 days | Medium |
| 12 | Scale the review | Gamified review | ~1 day after 11 | Low–medium |

#### Lead

1. **MCP server for the review app (prototype, demoable locally).** `[[TODO: confirm once built; match the tool
   list to what shipped.]]` A small Python MCP server (`mcp_server/`, registered in the project's `.mcp.json`)
   lets Claude Code or Claude Desktop work the review queue directly.
   - **Read tools:** `get_progress`, `list_cases`, `get_case` (evidence, SOP check, planned ops), `search_crm`,
     `get_account`, `list_runs`.
   - **Write tools:** `approve_case` (optional edits and note), `reject_case`, `reopen_case`, and `run_pipeline`
     (dry run by default).
   - **The design point is one executor and no logic forks.** The server calls the review app's own JSON API,
     so every write from Claude goes through the same atomic claim, precondition re-check, CHOW/duplicate
     sequencing and audit trail as a click in the UI, recorded as `decided_via: "mcp"`.
   - Claude Code's per-tool permission prompt is the human approval on every write, so "nothing writes without
     approval" still holds.
   - Demo: "show me the next pending case and its evidence" → "approve it" → the change shows up in the UI and
     in the CRM.

   **Where it goes next:**
   - *Daily triage.* After the scheduled run, Claude works the new queue. It reads each case, checks the
     evidence, looks up related accounts, and pre-drafts a decision (approve, reject, or edit, with a note) for a
     human to confirm in one click. Claude drafts; a person still approves every write.
   - *Investigating the hard cases.* For accounts that have dropped off the website, Claude searches the CRM and
     public sources for the likely new owner and attaches what it found as evidence. The reviewer gets a
     recommendation instead of a dead end.
   - *Calibration.* Comparing Claude's drafts with the human's final calls gives a running accuracy measure per
     case kind. That is the evidence for deciding when a kind is safe to auto-approve (item 10).
   - *Team use.* A hosted MCP with per-user auth would let the sales ops team ask "which facilities changed
     owner this week?" from their own Claude. This needs real identity first (item 11).

#### Trust the daily run

2. **Scrape health guard.** The scraper already reports its count against the homepage claim and any missing
   fields, but only as warnings. Next is making a bad report a hard stop before matching, whenever the count
   drops sharply or required fields go blank. In an unattended daily job the dangerous failure is the silent one:
   a layout change that returns zero communities would propose that every Bellhaven account is orphaned.
3. **Pipeline tracking page.** A simple visuals page over the run and case history the app already stores:
   - Run history: status, duration, trigger, and scrape count against the claim.
   - Cases opened per run, by kind.
   - Time to decision, from a case's first appearance to its decision, shown as a median plus a backlog-age view.

   Time to decision is the number sales feels, because it's how long the CRM stays wrong after ownership
   changes. The page is cheap because the data already exists.
4. **Snapshot diffs and ownership timeline.** Dated scrape snapshots already exist (`data/scrapes/`). Diff each
   one against the previous so only real changes become cases: new, removed, renamed, moved, or care offerings
   changed. Keep a dated history of parent changes per facility. That answers the question the exercise opens
   with: who owns this facility right now, and since when.

#### Better ownership signals

5. **Independent ownership data.** Pull in CMS's public Skilled Nursing Facility *All Owners* and *Change of
   Ownership* datasets (CSV/API, keyed on the CMS certification number) to catch a CHOW from the filing itself,
   even when the operator's website hasn't changed. CMS covers only Medicare-enrolled skilled nursing, so state
   licensure records fill the gap for assisted living and memory care. Stable regulatory IDs also make matching
   less dependent on names that change with every rebrand. Official bulk data comes first. Some state lookups are
   search forms that resist automation, and for those my Selenium human-behavior layer (`human_simulator.py`)
   plugs into the same scraper (see item 8). It was deliberately left out here because Bellhaven's site has no
   bot detection.
6. **Multi-operator site adapters.** Give each operator one config entry (entry URLs, pagination strategy, field
   selectors, the parent account id), all sharing one scrape, normalize, match and review core. Bellhaven's quirks
   (a homepage-only community, out-of-range pages that repeat) are exactly the per-site details that belong in
   config, not code.
7. **Acquisition-aware sweeps.** Watch operators' About and news pages. When an acquisition is announced, queue
   every CRM account under the seller's parent for review. Bellhaven shows why this has to stay a review trigger
   and not an automatic change: all of Harborview moved, but only "select" Cedar Trail communities did.

#### Put it in front of sales

8. **Decision-maker contacts and enrichment.** Knowing the parent only helps if sales knows who to call there.
   - **Free baseline:** every community page lists its administrator and phone, and the CRM already has a
     contacts resource (67 contacts today, including administrators who line up with the website).
   - **Enrichment:** use RocketReach's API for decision-makers' emails and direct lines. That means the facility
     (administrator, executive director) and especially the parent (regional operations, procurement), because
     outreach to corporate-owned facilities often has to go through the corporate office.
   - **LinkedIn:** watch for role and tenure changes. New leadership after a CHOW is both an ownership signal and
     a reason to call. I've run LinkedIn automation in production (`human_simulator.py`), so the capability is
     real. LinkedIn's terms restrict automated access, though, so this path needs compliance sign-off first, and
     the licensed provider stays the default.
   - **Storage:** a separate contacts table linked to CRM account ids, with the source, retrieval date and
     confidence for each field, and history kept when someone leaves. New or changed decision-makers become
     review cases and reach the CRM's contacts through the same executor.
   - **Trigger:** on every CHOW or new community, enrich the new account and alert its owner. Enriching only on
     events and priority accounts keeps per-lookup provider costs down.
9. **Account map dashboard.** This is a prominent view that makes the ownership picture legible at a glance.
   - Every account appears as a dot on a zoomable US map, geocoded once from its billing address. The free US
     Census geocoder handles US addresses in batch.
   - A toggle colors the dots either by sync status (in sync or needs attention) or by parent group.
   - Clicking a dot opens an info card: parent, care type, revenue and AR, and any open case.
   - A "needs attention" filter leaves only the open cases on the map.
   - Cases resolve from the hover card. The card shows the same evidence and one-click approve as the case
     screen and calls the same executor, so the map is another view onto the review queue, not a second write
     path.

   Sales leaders think in territories, and an acquisition's footprint (which facilities moved and which didn't)
   reads faster on a map than in a list.

#### Scale the review

10. **Learn from review decisions.** Store each decision with its match features, report precision by case kind,
    and tune thresholds. Auto-approve a kind only after a sustained run of approvals with no rejections, using
    the MCP calibration data from item 1. Never auto-approve CHOW or duplicate writes, because they create or
    inactivate accounts and the API has no delete or merge to undo them cleanly.
11. **Reviewer workflow.**
    - Per-user sign-in in place of the shared passcode.
    - Assignment by operator or region.
    - A daily Slack digest ("12 new cases, 2 CHOW").
    - An audit view over the decision records the app already keeps.

    This matters once more than one person reviews, and it gives billing a named trail for every CHOW.
12. **Gamified review.**
    - Streaks and milestones, extending the planned 100% celebration to daily streaks and "backlog cleared"
      moments.
    - Team leaderboards once per-user sign-in exists (item 11).
    - **Guardrail: rank on quality, not just speed.** Count only decisions that weren't later reopened and that
      agree with spot-checks. Keep CHOW and duplicate cases out of speed metrics, because rushing those is
      what costs billing.

    This matters when a team is clearing a large backlog. For a single reviewer, the progress visuals already do
    the job.

**Suggested order:** 1 (prototype in hand) → 2 → 4 → 8 → 5 → 3 → 9 → 6 → 7 → 10 → 11 → 12.
- Items 2 and 4 make the daily job safe to leave unattended, and 3 makes it visible. Item 3 is cheap and can
  slot in anywhere.
- Item 8 is where sales feels it first: the right person to call, right after ownership changes.
- Item 5 is the biggest accuracy gain, and 9 makes the whole picture legible to sales leaders.
- Items 6 and 7 are the scale step, and they get cheaper once 4 exists.
- Items 10–12 pay off as volume and team size grow. Item 1's triage mode is useful from day one.
