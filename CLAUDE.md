# Bellhaven CRM Sync — project brief

Clipboard Health **Sales Operations Analyst** take-home. Keep a CRM's facility → parent-company links accurate by
scraping an operator's website, matching locations to CRM accounts, and writing human-approved fixes back via API.
Deadline: **2026-11-23 18:39 UTC**. Target effort ~2 focused hours (time is reported honestly; a fast, sound
submission beats a long perfect one). Followed by a 45-min live walkthrough that **includes a small live change** —
so keep the matching rules readable and centralized.

## Deliverables (all required)
1. **Scraper** — every Bellhaven location: name, address, city, state, zip, care offerings. Python + Selenium.
2. **Matching** — link each location to the right CRM account and classify. Must handle at least:
   confident match · match needing a fix (wrong parent, outdated name, …) · location with no CRM account ·
   CRM accounts under the Bellhaven parent that are no longer on the website.
3. **Review app** — each proposed change with its supporting evidence; approve / reject.
   Approved changes write to the CRM via API. **Nothing writes without approval.**
4. **Built to run daily** — schedule config (GitHub Actions workflow; need not be live). **Re-runs must be safe and
   must not re-propose items already decided** (approved OR rejected).
5. **The submission is a corrected CRM, not just a tool.** Actually run the pipeline, review, and approve the right
   proposals before the deadline. Unapproved queue = same score as doing nothing.
6. ~2 min demo video: show proposals + evidence, approve one, reject one, show the change in the CRM browser.
7. Writeup (≈ half page): matching approach, how AI tools were used, what to build next. Honest hours.

## CRM conventions (sandbox API — no merge, no delete)
- `parent_id` links a facility to its parent-company account.
- `status` ∈ {`Active`, `Inactive`, `Needs Review`}; `note` is free text — use both to express non-field outcomes.
- **Duplicates:** on the LOSING copy set `duplicate_of_account` = surviving account id AND `status` = `Inactive`.
- Accounts carry `lifetime_revenue` and `outstanding_ar`.

## CHOW SOP — weighed as heavily as the matching itself
When an account needs to move to a **different parent**:
- If `lifetime_revenue > 0` **AND** `outstanding_ar > 0` → **do NOT change its parent.** Leave the old account exactly
  as is, **create a new account** for the facility under the correct parent, and set `chow_current_account` on the
  **OLD** account = the new account's id.
- Otherwise (no revenue history, or no outstanding AR) → re-parent the existing account directly.

## Website facts (verified 2026-11-21)
- Base: https://analyst-assessment-production.up.railway.app — server-rendered HTML, no bot detection.
- `/communities` directory: "34 communities listed", 16 per page, 3 pages. **Out-of-range `?page=N` returns the last
  page again** (never empty) → paginate by following the "Next →" link until it disappears; dedupe by slug.
- **Homepage says 35 communities.** The 35th, *Bellhaven Meadows of Findlay* (Findlay, OH), is linked only from the
  homepage "New this year" notice — not in the directory. The scraper must also harvest homepage community links.
- Detail page `/communities/<slug>` holds the source of truth: `<dl class="detail">` with Address (`street<br>City, ST ZIP`),
  Care Offerings (badges; can be several), Administrator, Phone.
- *Amberly Manor* (Hudson, OH) has no "Bellhaven" in its name → name search for "bellhaven" alone will miss it.
- About page: acquired **Harborview Care Group** (2025) and **select** communities from **Cedar Trail** (2026)
  → expect accounts still parented under Harborview / Cedar Trail. "Select" = not every Cedar Trail facility moved.
- Corporate office: 400 Bellhaven Way, Columbus, OH.

## Repo layout (planned)
- `pipeline/` — Python: Selenium scraper, CRM client, matcher, proposal store, CLI (`python -m pipeline run`).
- `web/` — Next.js review app (UI patterns + lordicons borrowed from Ryan's zenith-web-app).
- `.github/workflows/daily-sync.yml` — daily schedule.
- `docs/` — initial prompt, verbatim prompt log, writeup, plan.

## Working rules (from Ryan)
- **Matching logic:** present an outline of the structure/logic to Ryan and get corrections BEFORE implementing deeply.
- **Prompt log:** every user prompt (including mid-turn messages) is appended verbatim to `docs/prompts-log.md` by
  the UserPromptSubmit hook. Don't append manually (would duplicate); only check it if the hook seems to have failed.
- **Review app UX (Ryan's direction):** intuitive and simple. **One case at a time**, with all the context needed
  to decide on that one screen. Simple buttons + input boxes to adjust the fields being changed. The duplicate and
  CHOW rules are executed by the app — the human reviews the reasoning, then confirms with **one click**.
  Strong visuals for review progress (how many done / left, by category).
- No human-like / evasion scraping (site has no bot detection). Mention in the writeup that this capability exists
  (Ryan's `human_simulator.py`) for future sources that resist scraping.
- **Secrets:** repo is PUBLIC. The CRM token lives only in `.env` (gitignored). Never commit, print, or log it.
  The original exercise page is at `docs/project-instructions-page.txt` (token already replaced with `MY_TOKEN`).
- Host the review app on Vercel after it works locally — protect write actions (token is server-side only).
- **Commits:** small, segmented, well-described commits (one concern each, conventional prefixes like `feat(scraper):`,
  `docs:`, `chore:`), pushed regularly, so the repo history documents progress. Never batch unrelated work.
- **Never create test records in the CRM.** Its end state is graded; the only writes are approved proposals.

## CRM facts (recon 2026-11-21, read-only)
- `GET /accounts` → `{data, page, page_size, total}`; page_size up to 100. 121 accounts, 67 contacts. Id field `account_id`.
- Account fields: name, parent_id, parent_name, billing_street/city/state/zip, care_type, phone, status,
  lifetime_revenue, outstanding_ar, duplicate_of_account, chow_current_account, note, created_by_candidate, updated_at.
- Parents: Bellhaven `0015QAPLGS3FVYEEEM` (29 children), Juniper Point (30), Stonebridge (25), Harborview (5),
  Cedar Trail (5), Millstone (1). 20 facilities have no parent.
- Care-type vocab: site "Short-Term Rehabilitation & Nursing" = CRM "Skilled Nursing"; "Memory Support" = "Memory Care".
- Decoys: "Amberly Manor" (Juniper, Colorado Springs) ≠ site Amberly Manor (Hudson, OH); "Union Square Senior Living"
  (Juniper, 240 Market St) ≠ Bellhaven at Union Square (118 Union Square Dr). Address is identity; names are labels.
- Contacts (title Administrator) matching the website's administrator are strong match evidence.
- Pre-change snapshot of the CRM is committed in `data/crm-snapshot-before/` (the CRM changes once we approve).
