# Plan: Bellhaven CRM Sync (Clipboard Sales Ops take-home)

## Context
Clipboard needs facility → parent-company links kept accurate as LTC facilities get bought, sold and rebranded.
The exercise has four parts:
1. Scrape every Bellhaven community.
2. Match each one to CRM accounts and classify it.
3. Queue the proposed fixes with evidence in a review app. Only approved changes are written via the API.
4. Make it re-runnable daily without re-proposing anything already decided.

**What gets graded is the corrected CRM end state plus the system that produced it.** So the plan ends with
Ryan actually reviewing and approving the changes, recording a ~2 min demo, and submitting the repo link, video
link, honest hours and a half-page writeup by **2026-11-23 18:39 UTC**. A 45-min live walkthrough follows that
includes a small live change, so the rules must stay readable and centralized.

All rules and traps from the instructions are in `CLAUDE.md` (the CHOW SOP, duplicates, status/note, no merge or
delete). Decisions Ryan has made so far:
- **Python + Selenium** scraper with flexible XPath and pagination.
- **Supabase Postgres** as the one shared store.
- **Vercel** hosting: public to view, passcode required to approve or reject.
- Review UX: **one case at a time** with full context, editable fields, and one-click confirmation of the
  duplicate/CHOW logic, plus progress visuals.
- **Light, tasteful motion** on hovers, page changes and decisions, so the app feels modern rather than static.
- **What next = a local MCP server**, so Claude can pull data from the review app and perform ops through it.
  Built after the core deliverables.

**Done so far:**
- Public repo https://github.com/ryanmillerhq/bellhaven-crm-sync
- `.env` (token slot), `CLAUDE.md` brief, `docs/initial-prompt.md`
- `docs/prompts-log.md` with an auto-logging `UserPromptSubmit` hook
- `writeup` agent (`.claude/agents/writeup.md`), first draft running

## Site findings that shape the scraper (verified)
- 34 communities in `/communities` (16 per page, 3 pages). **`?page=4+` returns page 3 again**, so the scraper
  follows the "Next →" link until it disappears, guarded by "stop if a page adds no new slugs" plus a page cap.
- **35th community:** *Bellhaven Meadows of Findlay* is linked only from the homepage notice. The scraper also
  harvests homepage community links and checks its count against the homepage claim ("35 communities").
- Detail pages hold the truth: Address (`street<br>City, ST ZIP`), Care Offerings (several badges), Administrator, Phone.
- *Amberly Manor* (Hudson, OH) isn't named "Bellhaven". The About page says Harborview Care Group was acquired in
  2025 and **select** Cedar Trail communities in 2026, so expect stale parents under Harborview or Cedar Trail.

## Architecture
```
pipeline/ (Python)      scrape (Selenium) → fetch CRM (read-only) → match → proposals → upsert to Postgres
web/ (Next.js 16)       one-case-at-a-time review UI → on approve: re-validate → execute API ops → record result
  web/lib/cases.ts      service layer (the single executor), used by server actions (UI) + /api/cases (MCP)
mcp_server/ (Python)    MCP tools for Claude → calls the review app's /api/cases (same executor, same audit)
Supabase Postgres       runs, proposals (+ decisions, results): the shared memory that makes re-runs safe
.github/workflows/      daily-sync.yml: cron + workflow_dispatch, runs the pipeline (proposes only, never writes)
```
**Hard guarantee: the pipeline cannot write to the CRM.** Its client exposes GET methods only. The only write path
is the web app's executor, reached through an approved proposal.

### Data model (`db/schema.sql`)
- `runs`: id, started/finished, trigger (manual|schedule), status, counts, `scrape_snapshot` jsonb,
  `match_results` jsonb (classification of every location and every Bellhaven-parented account, including
  confident matches → the "In sync" view).
- `proposals`: one row per **case** (one facility).
  - Identity and content: `fingerprint` (unique), `kind`, `subject_key`, `title`, `reasoning[]`, `evidence` jsonb
    (website vs CRM, field by field), `account_snapshot`, `related_accounts`, `confidence`.
  - Execution: `operations` jsonb (ordered API ops, editable fields flagged), `preconditions` jsonb (CRM values
    the proposal assumed).
  - Lifecycle: `status` (pending | applying | applied | rejected | failed | stale | superseded),
    first/last_seen_run, `decided_at`, `decision_note`, `final_operations` (after reviewer edits), `result`, `error`.

### Re-run safety (idempotency)
- `fingerprint = sha256(kind | subject | canonical desired values)`.
- When the pipeline upserts a proposal:
  - Fingerprint already **applied or rejected** → skipped, never re-proposed.
  - Already **pending** → evidence and `last_seen_run` refreshed, no duplicate row.
  - **Pending, but not regenerated** this run (fixed outside the app) → `superseded`.
- Approved changes are inherently idempotent: the next run sees the corrected CRM and generates nothing.
- A *genuinely new* change (e.g. the website renames the facility again) produces a new fingerprint, so it
  surfaces even if an older proposal was rejected.
- **Executor safety:**
  1. Atomic claim `UPDATE … SET status='applying' WHERE id=$1 AND status='pending' RETURNING *`, so a
     double-click can't write twice.
  2. Re-fetch the involved accounts and check `preconditions`. If the CRM drifted (parent, revenue/AR branch,
     name), mark the case `stale` with a clear message.
  3. Run the ops in order and record each response. A partial failure (e.g. the CHOW create succeeded but the
     link failed) is retried without re-creating the account.
  4. Notes are **appended** with a dated `[bellhaven-sync]` line, never overwritten.

### Case kinds (draft only; finalized in the matching-outline gate below)
- **Confident match** → no proposal; listed under "In sync".
- **Needs fix** → field updates such as an outdated name, address or zip. A wrong parent goes to the SOP branch:
  - `lifetime_revenue > 0 AND outstanding_ar > 0` → **CHOW**: create a new account under Bellhaven with the website
    data, then set `chow_current_account` on the old account (otherwise untouched).
  - Otherwise → re-parent directly (plus any field fixes in the same PATCH).
- **Missing** → create the account under the Bellhaven parent.
- **Duplicate** → loser gets `duplicate_of_account` = survivor and `status` = Inactive, plus a note. The survivor
  rule is decided in the outline.
- **No longer on the website** (Bellhaven-parented, unmatched) → handling decided in the outline (likely
  Needs Review + note, or re-parent if the data shows the new owner).

## Phase plan
**0. Setup** ✅ (see Context).
- Right after approval:
  - Copy this plan to `docs/PLAN.md` and commit it.
  - Brief the `writeup` agent on the MCP "what next" direction.
  - Install the Python deps (`selenium`, `requests`, `python-dotenv`, `rapidfuzz`, `psycopg[binary]`, `pytest`)
    into a `.venv`.

**1. Unblock (Ryan)**
- Paste the token into `.env`.
- Create a free Supabase project and add `DATABASE_URL` to `.env`. Use the **transaction-pooler** URI (port
  6543): it's IPv4-safe for GitHub Actions and serverless-safe for Vercel.

**2. CRM reconnaissance (read-only)**
- `GET /me`, then page through all ~120 accounts and the contacts, dumped to the scratchpad (not the repo).
- Profile the fields, the parent accounts (Bellhaven, Harborview, Cedar Trail, …), duplicates, stale names,
  revenue/AR distribution, and existing `duplicate_of_account` / `chow_current_account` usage.

**3. Scraper**
- `pipeline/scraper.py`: Selenium headless Chrome via Selenium Manager, so no manual driver install.
- `pipeline/selectors.py` holds every XPath in one dict:
  - label-anchored and case-insensitive, e.g. `//dt[contains(translate(.,…),'address')]/following-sibling::dd[1]`;
  - badges via `contains(@class,'badge')`, with fallbacks.
- Flow: homepage links → directory with Next-button pagination → each detail page → regex parse of
  `City, ST ZIP` → `Location` records, plus a validation report (count vs. homepage claim, missing fields).
- Tests: parser tests on saved HTML fixtures, no network.

**4. 🛑 GATE: matching outline**
- `docs/matching-outline.md`, grounded in the real CRM data from Phase 2: candidate generation, signals and
  weights (normalized street + number, zip, city/state, name similarity after stripping brand words, phone if
  present), thresholds, classification tree, duplicate survivor rule, orphan handling, SOP branch, and each case
  traced against the real accounts.
- **Ryan corrects the structure and logic before any matching code is written.**

**5. Matching + proposals**
- `pipeline/normalize.py`, `pipeline/match.py` (rules and thresholds in one readable `RULES` block, for the live
  change), `pipeline/proposals.py` (ops, preconditions, fingerprints), `pipeline/store.py` (psycopg, upsert
  semantics above).
- CLI: `python -m pipeline run [--dry-run]`. Dry-run prints the case table without touching the DB.
- pytest: normalization, the SOP decision table (rev/AR: >0/>0, >0/0, 0/>0, null), duplicate survivor,
  fingerprint idempotency (second run = 0 new proposals).

**6. Review app** (`web/`, Zenith look and lordicons; details below)

**7. Review for real**
- Run the pipeline, then I pre-check each case and flag anything doubtful.
- **Ryan reviews and approves in the app.** Verify the end state via the API and the CRM browser. Re-run the
  pipeline to prove nothing gets re-proposed.
- Ryan records the 2-min demo here. I'll prepare a demo checklist.

**8. Daily schedule**
- `.github/workflows/daily-sync.yml`: `cron: "0 11 * * *"`, `workflow_dispatch`, `concurrency` group,
  ubuntu-latest (Chrome preinstalled), pip cache, secrets `CRM_API_TOKEN` and `DATABASE_URL`.
- Making it live means adding the repo secrets. I'll ask before sending the token to GitHub.

**9. Vercel**
- Root dir `web/`. Env: token, `DATABASE_URL`, `REVIEW_PASSCODE`, `SESSION_SECRET`.
- Mutating routes require a jose-signed httpOnly passcode cookie. The CRM-browser link (it embeds the token) is
  rendered only through a server-side redirect route, for authenticated sessions.

**10. MCP server: the "what I'd build next" prototype, demoed locally**
This comes after the core deliverables, so it can't put the deadline at risk.
- `mcp_server/` in Python using the official `mcp` SDK (FastMCP), registered in a project `.mcp.json`, so Claude
  Code (or Claude Desktop) connects straight to the review app.
- **Read tools:** `get_progress`, `list_cases(status, kind)`, `get_case(id)` (with evidence, SOP check, planned
  ops), `search_crm(q)`, `get_account(id)`, `list_runs`.
- **Write tools:** `approve_case(id, edits?, note?)`, `reject_case(id, reason)`, `reopen_case(id)`,
  `run_pipeline(dry_run=True)`.
- **One executor, no logic forks.** The MCP calls the review app's own JSON API (`/api/cases…`, protected by
  the passcode). Writes therefore go through the same atomic claim, precondition re-check, duplicate/CHOW
  sequencing and audit trail as the UI, recorded with `decided_via: "mcp"`.
- Claude Code's per-tool permission prompt is the human approval for every write, so "nothing writes without
  approval" still holds.
- Demo: "show me the next pending case and its evidence" → "approve it" → the change appears in the UI and the CRM.
- For this to work, the review app keeps its logic in a service layer (`web/lib/cases.ts`). It's shared by the
  server actions (UI) and thin `app/api/cases/*` route handlers (MCP).

**11. Finish**
- Writeup agent finalizes `docs/writeup.md` (submission text ≤ half page + extended notes). "What I'd build next"
  leads with the MCP prototype and where it goes next.
- Polish the README (setup, run, architecture, decisions).
- Offer to add the project to the `ryanmillerhq-portfolio` README.
- Ryan submits with honest hours.

## Review app UX (Ryan's direction: simple, one case at a time, progress visuals)
- **Progress header:** a ring for decided/total, a segmented bar by case kind (CHOW, re-parent, update, create,
  duplicate, orphan), and Pending/Approved/Rejected counts. A celebratory empty state at 100%.
- **Case card (one at a time)**, labeled "Case 4 of 12" with a kind badge and a confidence meter:
  1. *What we found*: 2–4 plain-English reasoning bullets.
  2. *Evidence*: Website vs CRM side by side, per-field ✓/≠ highlighting, links to the community page and the CRM record.
  3. *SOP check* (parent moves only): revenue and AR values → which branch applies, and why, in one sentence.
  4. *What will happen*: numbered plain-English steps for the exact API ops, with **input boxes pre-filled for
     the editable values** (name, address, …).
  5. **Approve** (one click runs the whole duplicate/CHOW sequence) · **Reject** (optional reason) · Skip.
     Keyboard: A / R / → .
- **Approve with a 5-second Undo toast** before the write fires. This is Zenith's `src/lib/queue/undoable-approval.ts`
  pattern; if the tab closes during the window, the pending write is flushed with a keepalive fetch.
- Secondary tabs: **History** (decided cases + results + reopen), **In sync** (confident matches = proof of
  coverage), **Runs**.

**Motion: light and tasteful, never in the way.** Uses `motion/react`, and everything respects
`prefers-reduced-motion`.
- Case paging: direction-aware slide and fade with `AnimatePresence` (approve exits left, next slides in), modeled
  on Zenith's `animate-slide-in-left/right` keyed by step in `strategy-review-flow.tsx:955`.
- Hover and press:
  - cards lift slightly (shadow + 1–2px rise)
  - buttons have `active:scale-[0.98]`
  - each lordicon plays once when its button or row is hovered
- Decision feedback:
  - approve → check `morph-tick` and a soft green flash
  - reject → cross morph and the card dims
  - the progress ring stroke animates and counts tick up
- Evidence rows fade in with a stagger (Zenith `FadeInGroup`: 70 ms, capped at 500 ms). A changed (≠) field gets
  one subtle highlight pulse (`zp-flash-highlight`).
- Tabs get an animated active pill (`layoutId`). Hitting 100% plays the celebration lordicon (`in-celebration`)
  once. No confetti.

**Borrowed from zenith-web-app** (all under `C:\Users\ryanm\My Drive\Code\zenith-web-app\`):
- Theme tokens from `src/app/globals.css`: dark default with hue-295 surfaces, accent `#a855f7`, radius 0.625rem.
  Also its motion keyframes, and `next-themes` with a light toggle.
- Geist and Geist Mono via `next/font` (`src/app/layout.tsx`).
- shadcn new-york `button`, `card`, `badge`, `input`, `textarea`, `tooltip`, `tabs`, `skeleton`, `label`, `dialog`
  from `src/components/ui/`. `progress` and `separator` get added with the shadcn CLI.
- `ProgressDonut` from `src/components/onboarding/strategy-tutorial/concept/scene-runner.tsx:646`, `StatCard` from
  `src/components/dashboard/new-dashboard.tsx:73`, `FadeIn` from `src/components/ui/fade-in.tsx`, and the sonner
  `<Toaster/>`.
- Lordicons: there's no wrapper in Zenith, so I'll write a small `<LordIcon>` around `Player`. It replays on parent
  hover and follows the theme color via `getComputedStyle`, like `drawer-icon-button.tsx`. ~12 JSONs get copied
  into `web/public/icons/lordicon/`:
  - check-31, cross-29, edit-114, search-42, refresh-150, warning-56, info-28, launch-122, home-41,
    history-141, copy-99, swap-154, celebration-134, spinner-718
- **Lordicon attribution:** Zenith has no license file, so the footer gets an "Icons by Lordicon.com" credit to
  be safe on the free tier.

## Verification
- `pytest` (parsers, normalization, SOP table, idempotency).
- Scraper live run returns **35** unique locations with complete fields.
- `python -m pipeline run --dry-run` case table, sanity-checked by hand against the CRM.
- Web: `npm run build` and a typecheck. Click-through in the browser: approve one, reject one, edit a field
  before approving, double-click approve (single write), a stale-precondition path.
- **End state:** fetch every touched account via the API and diff it against the expected outcomes. CHOW
  accounts keep their old parent, have `chow_current_account` set, and the new account exists under Bellhaven.
  Duplicates are Inactive with `duplicate_of_account`. Check in the CRM browser too.
- **Idempotency:** a second pipeline run creates 0 new proposals and leaves decided items untouched.
- **Motion:** hovers, case paging and decision feedback all animate, and nothing animates with OS
  reduced-motion turned on.
- **MCP:** from Claude Code via `.mcp.json`: list → get → approve one test case. Check it appears as decided in
  the UI with `decided_via: mcp`, and that the CRM change landed.
- **Vercel:** a logged-out visitor can browse but approve/reject is refused (401), and the token never appears in
  client bundles (`grep` the `.next/static` output).
