# Writeup: Bellhaven CRM Sync

Form-field reminders (not part of the text):
- Demo video: [[TODO: Loom / unlisted YouTube / Drive link, sharing set to anyone with the link]]
- Actual time spent: [[TODO: Ryan to fill honest hours]]

---

Matching approach

Address is identity; names are labels. Each of the 35 scraped communities (one linked only from the homepage) is matched on normalized street plus zip or city, with administrator, phone and name only as support; a name alone never matches (the CRM has same-name decoys in other states). The run produced 26 cases; 13 communities were already in sync:
- Parent moves: 3 re-parents, 2 CHOW, 1 sold.
- Duplicates (5): survivor chosen by billing history, then parent. Losers get duplicate_of_account and Inactive.
- Missing (4): created under Bellhaven.
- Renames (7, 4 cosmetic) and field fixes (2).
- Unlisted (2): Needs Review plus a dated note; new owner unknown.

CHOW SOP, on every parent change: revenue and AR both above zero means a new account under the correct parent, with only chow_current_account set on the old one (Tiffin, Marietta). Otherwise it's a direct re-parent (Lima, Findlay, Zanesville, Kettering). Sandusky left the site and Millstone already had an account there, so I linked to it rather than create a duplicate.

Nothing writes without approval. The pipeline only reads the CRM, and the app's executor re-checks each case and stamps "Approved by [name] via ui". Decided items never return.

Result: 25 approved and 1 rejected (Ashtabula's billing PO box, kept by policy), all in the UI. docs/end-state.md shows 6 created, 25 changed and 0 problems. Re-run: 0 new cases, 35/35 in sync.

How I used AI tools

Claude Code (Opus 5.5) wrote the code; every prompt is in docs/prompts-log.md. My calls: plan first; a matching outline whose eight judgment calls I decided before any matcher code; one-case-at-a-time review with one-click rules; and audit tracking. Three adversarial agents then attacked the matching. An independent auditor reproduced every outcome except Kettering's survivor, which is a deterministic tie-break. Checking the live system caught four bugs, all fixed, such as runs that reported "saved" but committed nothing (found by querying the database). Tests: 88 Python, 27 web.

What I'd build next

- MCP server, built (10 tools): Claude works cases through the review app's API, sharing its executor and audit stamp, with Claude Code's permission prompt as the human gate. Next, Claude triages the daily queue and pre-drafts decisions.
- Many operators, plus CMS change-of-ownership and state licensing data, to catch a CHOW before a website shows it.
- Contacts: RocketReach and internet profile enriching. My human_simulator.py handles sources that resist automation.

Details: README, docs/matching-outline.md, docs/end-state.md.
