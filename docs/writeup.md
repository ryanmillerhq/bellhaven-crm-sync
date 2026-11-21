# Writeup: Bellhaven CRM Sync

> **Status: draft 5 (2026-11-21).** Built so far:
> - the scraper, with a first snapshot of 35 communities committed;
> - a read-only CRM snapshot (121 accounts, 67 contacts);
> - the review-store migration;
> - the matcher and case builder (`python -m pipeline run`), following the approved outline and the
>   adversarial-review fixes, with 62 tests.
>
> The review app and MCP server aren't built yet, and the real run hasn't happened. Anything described from
> [PLAN.md](PLAN.md) is marked "planned" or carries a `[[TODO: confirm once built]]`.
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

Address is identity; names are labels. Locations match accounts on normalized street plus zip, with administrator, phone and name only as support, so name decoys never match.

- In sync: no proposal.
- Rename, field fix, parent move: one bundled case per facility.
- Missing: created under Bellhaven.
- Duplicates: the survivor has billing history, else the right parent. Losers get duplicate_of_account and Inactive.
- Unlisted: Needs Review with a dated note, unless another owner's account shares the address (sold).

CHOW SOP, on every parent change: revenue and AR both above zero means a new account under the correct parent, with chow_current_account set on the otherwise untouched old one. Anything else, nulls included, re-parents directly. If the new owner already has an account (Sandusky), I link to it instead of creating a duplicate.

Nothing writes without approval. The pipeline only reads the CRM, and the review app's executor re-checks it before each approved write, stamping who approved and how. Decided changes, down to the field, never return. [[TODO: confirm once the review app is built.]]

How I used AI tools

I used Claude Code (Opus 5.5), and every prompt is in docs/prompts-log.md, verbatim. It wrote the code; a separate agent drafted this writeup. My calls: plan before building; no human-like scraping (no bot detection); one review case per screen, rules applied in one click; and a matching outline flagging eight judgment calls for me to decide first. Then three adversarial reviewer agents attacked it. An independent auditor matched the end state on all 35 locations and 3 sweep accounts except one deterministic tie-break. Their findings drove fixes like field-level decision memory and a scrape-collapse guard. My 62 tests include applying every case and re-running: 0 new cases, 35/35 in sync. [[TODO, ~8 words: e.g. "The end state was verified via API and CRM browser."]]

What I'd build next

- MCP server (prototype, demoable locally): Claude works cases via the review app's own API, so writes share the UI's executor, CHOW/duplicate logic and audit stamp, and Claude Code's permission prompt keeps a human on each write. All graded approvals were made in the UI. Next, Claude triages the daily queue and pre-drafts decisions. [[TODO: confirm once built.]]
- Beyond one website: per-operator config, plus CMS change-of-ownership and state licensing data to catch a CHOW before the website shows it.
- Decision-maker contacts: RocketReach and internet profile enriching (my human_simulator.py handles sources that resist automation).

<!-- END SUBMISSION TEXT -->

Length note: 371 words written, plus ~8 for the end-state verification TODO, ≈ 379 total. That leaves no slack.
If anything grows, shorten "Beyond one website" or the contacts bullet first. Keep these whole: the MCP bullet
(including "All graded approvals were made in the UI", which the rules review asked for), the Sandusky sentence
(it departs from the SOP's literal wording, so it has to be explained), and the adversarial-review sentences. The full set of ideas, including the map dashboard, pipeline-tracking page
and gamified review, is in the roadmap in Part 2. The map is the natural swap-in if Ryan would rather show it
than the contacts bullet (~20 words: "A zoomable US map of every account, colored by status or parent group,
with cases resolvable from the hover card.").

`[[TODO: refresh "How I used AI tools" from docs/prompts-log.md at the very end. It currently reflects prompts 1–13 and the adversarial review.]]`

---

## Part 2: Extended notes

These notes are for the README and the live walkthrough.

### Run results

`[[TODO: fill from real run output. Do not estimate.]]`

| Measure | Result |
|---|---|
| Communities scraped | 35, matching the homepage's claim: 34 from the directory (3 pages) plus Bellhaven Meadows of Findlay, which is linked only from the homepage (`data/scrapes/2026-11-21.json`). `[[TODO: update if the final run differs]]` |
| CRM before any change | 121 accounts and 67 contacts, snapshotted read-only in `data/crm-snapshot-before/` |
| Cases by kind | **Expected** (outline sections 10 and 12, traced against the real data): 26 review cases plus 13 in sync. The 26 are 3 CHOW (Tiffin, Marietta, and Sandusky linked to the existing Millstone account), 3 re-parents (Lima, Findlay, Zanesville with a rename), 5 duplicate cases (Kettering, also re-parented and renamed; Monroe; Port Clinton; Erie; Owosso), 3 renames, 4 cosmetic renames, 1 field fix (Portsmouth zip), 4 creates, 2 unlisted, and 1 optional Ashtabula PO box case (policy default: keep, so it's the planned on-camera Reject). Actual: `[[TODO]]` |
| Approved / rejected | `[[TODO]]`. All graded approvals are made in the review UI. Any MCP writes are demo only |
| CHOW vs. direct re-parent | **Expected:** 3 CHOW (Tiffin and Marietta get new accounts; Sandusky links to Millstone) vs. 4 direct re-parents (Lima and Findlay have revenue but no AR; Zanesville and the Kettering survivor have none). Actual: `[[TODO]]` |
| Re-run check | **Lifecycle test (simulated, in the suite of 62):** applying every case and re-running produces 0 cases and 35/35 in sync. Real second run: `[[TODO: N new proposals (expected 0)]]` |
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

Source: [matching-outline.md](matching-outline.md), which Ryan approved with all eight section-9 recommendations
accepted (prompt 13), and updated after the adversarial review (outline section 12, summarized below). The
matcher is built (`pipeline/match.py`, `pipeline/proposals.py`, `pipeline/store.py`) with 62 tests.

**Principle: address is identity; names are labels.** Ownership changes rename facilities (for example, "Riverbend
Manor Care Center" became "Bellhaven of Chagrin Falls"), but the building doesn't move. The physical address
drives matching. Administrator, phone and name only support a match or break ties, and a name alone never makes
one.

**Normalization.**
- Streets get USPS suffix and directional abbreviations, with punctuation stripped, so `1125 Logan Boulevard` ≡
  `1125 Logan Blvd`.
- Names are lowercased, `&` becomes "and", Rehab becomes Rehabilitation, Centre becomes Center, and "Health Care"
  becomes healthcare. Names are compared for similarity (rapidfuzz token-set ratio), never for identity.
- Care types are mapped to the CRM vocabulary.

**Signals and the match rule.**

| Signal | Role |
|---|---|
| Normalized street + zip equal | Decisive. 33 of 35 locations hit at least one account this way |
| Site administrator = an Administrator contact on the account | Strong support |
| Phone equal | Support only. Only about half of CRM phones match the site |
| Name similarity ≥ 90 | Support only, never sufficient alone |
| Same state, plus same zip or city | Gate for any candidate |

- A match needs either the address, or the gate plus at least 2 of {administrator, phone, name ≥ 90}.
- The second path catches Ashtabula, whose CRM billing street is "PO Box 517" but whose zip, phone and name all
  match.
- Confidence is High when the address matches plus at least one supporting signal. It's Medium for an address
  alone or for the non-address path.

**Per-location classification.** Each location gets one case that bundles all of its changes. Zanesville, for
example, is a re-parent plus a rename in one click. Settled records, meaning accounts with `duplicate_of_account`
or `chow_current_account` already set, are excluded from matching and from the sweep. Without that, the old and
new accounts left behind by a CHOW would be re-flagged as duplicates on the next run.
- **0 matched accounts →** Missing: create the account under Bellhaven.
- **2 or more →** Duplicates. Pick a survivor (below), and the losers get `duplicate_of_account` and Inactive.
  The survivor then runs through the single-account checks in the same case.
- **1 account (or the survivor) →** checked in this order:
  - parent isn't Bellhaven → parent move through the SOP;
  - name differs → rename;
  - address or zip differs beyond formatting, or the care type isn't among the site's offerings → field fix;
  - Inactive while listed → reactivate;
  - nothing differs → in sync, with no proposal.

**Duplicate survivor (ordered tie-breakers).**
1. Billing history (revenue or AR above zero), so billing stays intact. If several copies have it, there's no
   auto-pick and the case goes to Needs Review.
2. Already under Bellhaven.
3. The administrator contact matches the site, then the phone matches.
4. Most contacts.
5. The street matches the site's exact formatting.
6. Lowest `account_id`.

Marking a duplicate isn't a re-parent, so losers keep their parent and the SOP isn't triggered. Two refinements
came out of the adversarial review:
- **CHOW predecessors in a cluster.** A record under another parent with billing history *and* open AR is never
  marked a duplicate or Inactive. It's linked to the survivor via `chow_current_account`, and survivor selection
  runs over the remaining records.
- **Kettering is a tie-break, not evidence.** Its three records all have zero revenue and AR, none is under
  Bellhaven, none has contacts, and none matches the phone. The rule falls through to exact street formatting and
  then the lowest `account_id`, which picks Kettering Nursing & Rehabilitation. That's a deterministic tie-break,
  and the case reasoning says so. The independent auditor picked a different copy here, which was its only
  difference from the design.

**Per-account sweep.** This covers Bellhaven-parented accounts that match no location.
- **Same address as an account under another parent → sold.**
  - Revenue and AR both above zero: the old account gets `chow_current_account` pointing at the new owner's
    existing account (Sandusky). The explanatory note goes on that Millstone account, because the old one stays
    untouched.
  - Revenue but no AR: re-parent per the SOP. The record with history survives, and the new owner's bare record
    becomes its duplicate. Before the adversarial review, this case would have been marked a duplicate.
  - No billing history: marked a duplicate of the new owner's account, so the facility isn't counted twice.
- **No other account at the address → unlisted.** It gets Needs Review and a note (`no longer listed on bellhavenseniorliving site as of <date>; new owner unknown`), and the parent stays unchanged (Alliance,
  Coldwater).

**CHOW SOP.** This applies to every parent change, including "no parent → Bellhaven".
- Revenue > 0 and AR > 0: the parent stays untouched. The app creates a new account under the correct parent
  from the website data, then sets `chow_current_account` on the old account. Nothing else on the old account
  changes.
- Any other combination, with a null counted as "no history": re-parent directly.
- The executor re-checks revenue and AR at approval time. If the branch would flip, the case goes stale instead
  of writing.
- Decoys handled: Akron, Defiance, Meadville and New Carlisle all have revenue and AR but are already under
  Bellhaven. No parent move means no CHOW.

**Field policy.**
- Synced from the site: name, parent, billing street/city/state/zip, and care type (only when the CRM value isn't
  one of the site's mapped offerings).
- New accounts (creates and CHOWs) are Active, with name, address, care type (the first mapped offering), phone,
  and an explanatory note.
- Not treated as changes: formatting-only address differences such as Road vs. Rd.
- Not synced: existing accounts' phones. Ashtabula's "PO Box 517" billing street surfaces as an *optional*,
  low-confidence case labeled "policy default: keep → Reject", so the choice is visible instead of silent.
- In-sync rows flag stale Administrator contacts (Wooster, Saline, Sycamore Ridge, Lima). Contacts aren't synced
  in this version.

**Re-run safety beyond fingerprints** (all from the adversarial review):
- **Field-level decision memory.** A field change that was approved or rejected is never proposed again, even
  inside a differently shaped bundle, such as after a reviewer edits a name before approving. It returns only if
  the website's value changes.
- **Busy facilities are held.** A facility whose case is mid-apply or failed gets no new proposal, so a
  half-applied CHOW can't spawn a bogus duplicate case.
- **Fingerprints never include notes or dates.** This is tested across two simulated days.
- **Scrape-collapse guard.** If a scrape finds fewer than 90% of the last good run's communities, the sweep and
  superseding switch off, so a broken scrape can't mark every account unlisted.
- **Lifecycle test.** Applying every case and re-running produces 0 cases and 35/35 in sync.

**Live change.** Every threshold, the survivor order, the field-policy switches (`SYNC_PHONE`,
`COSMETIC_RENAMES`) and the normalization maps live in one `RULES` block in `pipeline/rules.py`. Most likely
live edits are one-line changes.

The matching also respects these facts from the site and the CRM:
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
| Re-run idempotency (built) | Each case gets `fingerprint = sha256(kind \| subject \| canonical desired values)`, never including notes or dates. Fingerprints already applied or rejected are skipped. Pending ones get fresh evidence, not a duplicate row. Pending ones that a run no longer generates (fixed outside the app) become `superseded`. On top of that, field-level decision memory means an approved or rejected field change never comes back inside a different bundle, and busy facilities (mid-apply or failed) get no new proposal | Never re-proposes a decided item, including after a reviewer edits a value before approving. A genuinely new change on the website still surfaces | PLAN.md; outline §11–12; `pipeline/store.py` |
| Settled records excluded (built) | Accounts with `duplicate_of_account` or `chow_current_account` already set are excluded from matching and from the sweep | After a CHOW, the old and new accounts share an address. Without this they'd be re-flagged as duplicates, and billing-history-first would even keep the old one | Adversarial review; lifecycle test |
| Scrape-collapse guard (built) | If a scrape finds fewer than 90% of the last good run's communities, the sweep and superseding switch off | A broken scrape must not turn into "every account is unlisted" | Adversarial review |
| Audit stamp | Every decision and write records who and how (UI or MCP). Approved CRM notes get the suffix `Approved by <name> via <ui\|mcp>` `[[TODO: confirm once built]]` | The CRM sees one shared API token, so without the stamp every change would look like it came from the same user | Ryan |
| Graded approvals happen in the UI | Every approval behind the submitted CRM state is made in the review UI. MCP writes are a demo of what comes next, gated by Claude Code's permission prompt | The exercise asks for review in "your app"; the rules review flagged keeping the two separate | Adversarial (rules) review |
| Executor safety (planned) | An atomic claim (`pending` → `applying`) means a double-click can't write twice. The executor re-fetches the accounts and checks preconditions, and marks the case `stale` if the CRM drifted. Ops run in order, and a partial CHOW (create succeeded, link failed) retries without re-creating the account. Notes are appended with a dated `[bellhaven-sync]` line, never overwritten | The API has no merge or delete, so a write has to be right the first time and must never clobber what reps wrote | PLAN.md |
| Review UX | One case per screen with all the context needed to decide. Simple buttons, plus input boxes to adjust the fields being changed. The app executes the duplicate and CHOW rules, and the reviewer checks the reasoning and confirms with one click. Progress by category is always visible | Fast, consistent reviews. The SOP is applied the same way every time instead of depending on the reviewer remembering it | Ryan, prompt 3 |
| Motion | Light, tasteful motion on hovers, case paging and decision feedback (see the design notes) | Makes the app feel modern rather than static without slowing review | Ryan, prompt 4 |
| Matching built outline-first | The AI outlined the matching against the real CRM data and flagged eight judgment calls. I decided them, accepting all eight recommendations, before any matcher code was written | Matching is the judgment-heavy part, and it has to stay readable for the live change | Ryan, prompts 1 and 13 |
| Address is identity | Normalized street + zip decides a match. Administrator, phone and name only support it | Ownership changes rename facilities but don't move buildings, and the CRM has name decoys (Amberly Manor, Union Square) | Outline §1, §3 |
| Scraper (built) | Selenium with label-anchored, case-insensitive XPaths over each community's detail page, with the parsing kept in pure, testable helpers | My call. The detail page holds the address, care offerings, administrator and phone, and anchoring on labels survives small layout changes | Ryan, prompt 2; `pipeline/scraper.py` |
| Pagination (built) | Follow the "Next →" link, dedupe by slug, stop when a page adds no new communities, and cap the page count | An out-of-range `?page=N` returns the last page again, so a page-number loop never sees an empty page | Prompt 2 left the choice to robustness; `pipeline/scraper.py` |
| Coverage (built) | Also harvest community links from the homepage, and report the total against the homepage's "35 communities" | The directory lists 34. The 35th appears only in the homepage's "New this year" notice. The first run found 35 of 35 | Site check; `data/scrapes/2026-11-21.json` |
| No test records in the CRM | The only CRM writes are approved proposals. Nothing gets created "to try it out" | The CRM's end state is what gets graded | Ryan's working rules (CLAUDE.md) |
| Pre-change snapshot (built) | All accounts and contacts were captured read-only before any write | The end state can be diffed against the starting state, which also gives a record of exactly what changed | `data/crm-snapshot-before/` |
| No human-like scraping | Plain Selenium | The site has no bot detection, and evasion adds complexity for no gain. The capability exists for future sources (see roadmap) | Ryan, prompt 1 |
| Secrets and hosting (planned) | The token lives only in a gitignored `.env` and server-side env vars. The hosted app on Vercel is public to view, but approve and reject need a passcode (signed httpOnly cookie). The CRM-browser link, which embeds the token, is served only through a server-side redirect for signed-in sessions. The prompt-log hook redacts the token, and I removed it from the exercise page before sharing the page with the AI | Public repo, public app | Ryan, prompt 1; PLAN.md |
| Schedule (planned) | `.github/workflows/daily-sync.yml`: `cron: "0 11 * * *"` plus manual dispatch, a concurrency group, and secrets for the token and the database URL. It runs the pipeline, which only proposes. State persists in Postgres between runs | Required by the exercise. Making it live means adding the repo secrets, which is Ryan's call | PLAN.md |
| Duplicate survivor | Ordered tie-breakers: billing history (if several copies have it, there's no auto-pick and the reviewer decides), then already under Bellhaven, administrator then phone match, most contacts, exact street formatting, and lowest `account_id`. Losers get `duplicate_of_account`, Inactive, and an appended note, and their parent is untouched | Billing must stay intact on the surviving record. The order is deterministic, so a re-run picks the same survivor. Marking a duplicate isn't a re-parent, so the SOP doesn't fire | Outline §5 |
| CHOW predecessor inside a duplicate cluster | A record under another parent with billing history and open AR is never marked a duplicate or Inactive. It's CHOW-linked to the survivor, and the survivor is picked from the remaining records | Marking it Inactive would bypass the SOP's protection of accounts that billing still needs | Adversarial review |
| Duplicates that also need a parent move | Duplicates resolve first. The survivor then goes through the parent-move/SOP check in the same case (Kettering) | One case per facility, and the SOP runs on the record that survives | Outline §4 |
| Kettering survivor | Kettering Nursing & Rehabilitation, picked by a deterministic tie-break (lowest `account_id`), not by evidence. All three records have zero revenue and AR, none is under Bellhaven, and none has contacts or a phone match. The case reasoning says this plainly | Some rule has to decide, and a deterministic one gives the same answer on every run. The survivor is re-parented to Bellhaven and renamed in the same case, whichever copy it is. The independent auditor picked a different copy here, its only difference from the design | Outline #8 (accepted), §12 |
| Status / note per outcome | Duplicate losers become Inactive. Unlisted accounts become Needs Review. Created accounts are Active. Everything else keeps its status, apart from a reactivation if a listed facility is Inactive. Notes are appended with a dated `[bellhaven-sync]` line, never overwritten, and carry the audit stamp. On a CHOW, the note goes on the new account (for Sandusky, on the existing Millstone account) | Status and note carry the outcomes a field update can't express, and never erase what reps wrote | Outline §4–8, #7, §12; PLAN.md |
| Unlisted (Alliance, Coldwater) | Needs Review plus a dated note (`no longer listed on bellhavenseniorliving site as of <date>; new owner unknown`). The parent is unchanged | There's no evidence of who owns them now. Inactive, or detaching the parent, would assert something we don't know, while Needs Review hands it to a human | Outline #4 (accepted) |
| Sold (another owner's account at the same address) | If revenue and AR are both above zero, set `chow_current_account` to the new owner's existing account. With revenue but no AR, re-parent per the SOP: the record with history survives and the new owner's bare record becomes its duplicate. With no billing history, mark it a duplicate of the new owner's account (Inactive) | The facility shouldn't be counted twice, and the record with billing history should be the one that survives | Outline §6; the revenue-without-AR branch came from the adversarial review |
| Sandusky: CHOW to an existing account | The Bellhaven account (rev $130k / AR $5.2k) is gone from the site, and a Millstone account exists at the same address. The old account's `chow_current_account` points to that existing Millstone account, and no new account is created | The SOP's intent is "preserve the old account, point to the current one". Creating a second Millstone account would manufacture a duplicate. This departs from the SOP's literal "create a new account", which is why it's called out | Outline #5 (accepted) |
| CHOW old account | Only `chow_current_account` is written. The explanatory note goes on the new account | A strict reading of "leave the existing account exactly as it is" | Outline #7 (accepted) |
| Null revenue or AR | Counts as "no history", so the account is re-parented directly | Follows the SOP's wording: "no revenue history, or no outstanding AR" | Outline §7; Ryan |
| SOP scope | Applies to every parent change, including no parent → Bellhaven (Findlay) | Billing protection shouldn't depend on whether the account had a parent before | Outline §7 |
| Missing location, so create | A new Active account under Bellhaven with name, address, care type (the first mapped offering), phone and an explanatory note (Batavia, Carlisle PA, Union Square, Amberly Manor Hudson) | Four communities have no CRM account at their address. Two of them have similarly named decoys elsewhere | Outline §4, §8 |
| Contacts on duplicate losers | Active contacts are re-pointed to the survivor (only Owosso today: one Admissions Director) | So they don't vanish onto an Inactive record | Outline #6 (accepted) |
| Phone | Not synced on existing accounts, and used as evidence only. New accounts get the site phone. `SYNC_PHONE` flips it | Phone isn't a required scrape field, and about 17 of 35 differ, which would mostly add review noise | Outline #2 (accepted) |
| PO box billing street (Ashtabula) | Kept. It surfaces as an optional, low-confidence case labeled "policy default: keep → Reject", which is the planned on-camera Reject in the demo | A billing PO box is legitimate, and the field is the *billing* street. Making it a visible case means the decision is reviewable instead of silent | Outline #3 (accepted), §12 |
| Cosmetic renames (Dayton, Ashland, Grove City, Sycamore Ridge) | Renamed to the exact website name and tagged "cosmetic". `COSMETIC_RENAMES` turns them off | The website is the source of truth for names, and the tag makes these quick to review or reject | Outline #1 (accepted) |

**Re-run traps, now handled.** Fingerprints stop the same change from being re-proposed, but these cases would
have generated *different* proposals. Settled records are now excluded from matching and the sweep, and the
lifecycle test (apply every case, re-run) produces 0 cases and 35/35 in sync.
- **After a CHOW (Tiffin, Marietta),** the old account and the new Bellhaven account share an address. Without the
  exclusion, billing-history-first would have kept the *old* account and proposed the new one as its duplicate.
- **After Sandusky,** the old Bellhaven account still shares an address with the Millstone account, so the sweep
  would have proposed "sold" again.
- **Duplicate losers** aren't re-clustered or picked as survivors.

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
- **Audit stamp:** every decision and write records who approved it and how (UI or MCP). The approved CRM note
  ends with `Approved by <name> via <ui|mcp>`, because the CRM only sees the one shared API token.
  `[[TODO: confirm once built; note how the reviewer's name is captured.]]`
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
- The scraper's selectors are specific to this site's HTML. A scrape that collapses below 90% of the last good
  run switches off the sweep and superseding, so it can't mark accounts unlisted. Matching and new proposals still
  run, though, and there's no alert yet (roadmap item 2).
- The API has no delete or merge. Undo exists only during the 5-second window before a write fires. After that,
  a mistakenly created account can only be marked Inactive.
- There's one shared passcode, not per-user accounts. Decisions record who and how (UI or MCP), and approved
  notes carry `Approved by <name> via <ui|mcp>`. Under a shared passcode, though, the name is self-declared, not
  authenticated (roadmap item 11).
- Contacts are mostly used as match evidence. This version writes contacts only to re-point active contacts off
  a duplicate loser. In-sync rows flag stale Administrator contacts (Wooster, Saline, Sycamore Ridge, Lima), but
  nothing creates or updates contacts from the website (roadmap item 8).
- Address is identity. A facility that moved *and* was renamed between runs would surface as a missing case plus
  an unlisted case, not as one match. The reviewer would see both, but the system wouldn't connect them.
- Unlisted accounts (Alliance, Coldwater) stay under Bellhaven as Needs Review until someone finds the new owner.
  Nothing in this version researches that (roadmap item 1, "investigating the hard cases").
- Phones on existing accounts aren't synced, so about half stay different from the website until `SYNC_PHONE` is
  turned on.
- The MCP prototype is a local demo. Every graded approval is made in the review UI. `[[TODO: confirm once
  built.]]`

### Prompt-log highlights (how I directed the AI)

`[[TODO: extend with every later prompt, especially corrections to the AI's output and checks I made it run.]]`

| Prompt | What I directed | Effect on the build |
|---|---|---|
| 1 | Plan thoroughly before starting, and read the instructions as closely as I had ("a few complexities and intricacies") | A project brief (CLAUDE.md) recording the site's traps and the CHOW SOP, and a phased plan (PLAN.md), both before any code |
| 1 | Outline the matching logic for my correction before going deeper | A hard gate in the plan (phase 4). `docs/matching-outline.md` traced every case against the real CRM and flagged eight judgment calls, and I accepted all eight recommendations (prompt 13) |
| 1 | No human-like scraper, but note the capability for future sources | Plain Selenium. The capability is noted in the roadmap |
| 1 | Removed my API token from the page myself, and asked for a `.env` | Token kept out of the shared page and the public repo |
| 1 | Verbatim prompt log, a separate writeup agent, a UI based on my zenith-web-app (with lordicons), hosting on Vercel | `docs/prompts-log.md` via a hook; this document. I created the Vercel project, connected to the repo, at https://bellhaven-crm-sync.vercel.app/ (prompt 8). `[[TODO: review app UI, app deployed]]` |
| 2 | Selenium navigation, a flexible XPath per community page, and pagination by URL or buttons, whichever is more robust | Built: follow-"Next" pagination, because an out-of-range `?page=N` repeats the last page. The first scrape found 35 of 35 |
| 3 | Review app: intuitive, one case at a time with all the context on one screen, simple buttons and inputs, the duplicate and CHOW logic as one-click confirmation, strong progress visuals | The case card and progress header in the design notes. `[[TODO: confirm built]]` |
| 4 | An MCP server so I can connect Claude directly to the review app to pull data and perform ops, demoed locally; light, tasteful animations | The MCP prototype (plan phase 10) leads "What I'd build next", and the motion spec is in the design notes. `[[TODO: confirm built]]` |
| 7 | Small, segmented, well-described commits throughout | The git history documents the build step by step: one concern per commit, with conventional prefixes |
| 9 | Put any Supabase migrations in a `_run-me` folder for me to run | I apply database schema changes myself. The first migration covers runs, cases and case events |
| 10 | More "what next" ideas: contact enrichment (internet profile enriching, RocketReach, a separate contacts table), a pipeline-tracking page, a US map dashboard with hover-card resolution, and gamified review | Roadmap items 3, 8, 9 and 12 |
| 13 | Approved the matching outline ("all recommendations OK"); asked for an adversarial agent team to review the matching logic, then the build and the real run-through | Three reviewer agents attacked the matching before the real run:<br>- An independent end-state auditor derived its own answer first and matched all 35 locations and 3 sweep accounts, differing only on the Kettering tie-break.<br>- A rules-lawyer read the instructions literally.<br>- An edge-case breaker went after the multi-day lifecycle.<br>Their fixes: CHOW predecessors in duplicate clusters, the sold-without-AR SOP branch, field-level decision memory, holding busy facilities, the scrape-collapse guard, and the PO box as an optional case. The suite grew to 62 tests (outline §12) |

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
| 8 | Put it in front of sales | Decision-maker contacts and enrichment | ~2 days; internet profile enriching +2–3 days | High |
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
     approval" still holds. MCP writes carry the audit stamp `Approved by <name> via mcp`.
   - **Scope for this submission:** every graded approval was made in the review UI. MCP writes are a demo of what
     comes next, not part of how the submitted CRM state was produced.
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

2. **Scrape health guard, the rest of it.** Built already: the scraper reports its count against the homepage
   claim and any missing fields, and a scrape below 90% of the last good run switches off the sweep and
   superseding, so it can't mark accounts unlisted. Next is a full stop before matching, plus an alert, whenever
   the count drops sharply or required fields go blank. In an unattended daily job the dangerous failure is the
   silent one.
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
     contacts resource (67 contacts today, including administrators who line up with the website). This version
     already flags stale Administrator contacts on in-sync rows (Wooster, Saline, Sycamore Ridge, Lima). Turning
     those flags into review cases is the first step.
   - **Enrichment:** use RocketReach's API for decision-makers' emails and direct lines. That means the facility
     (administrator, executive director) and especially the parent (regional operations, procurement), because
     outreach to corporate-owned facilities often has to go through the corporate office.
   - **Internet profile enriching:** watch public professional profiles for role and tenure changes. New
     leadership after a CHOW is both an ownership signal and a reason to call. I've run this kind of profile
     automation in production with `human_simulator.py`, which handles sources that resist automation.
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
    - Per-user sign-in in place of the shared passcode, so the audit stamp's name is authenticated rather than
      self-declared.
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
