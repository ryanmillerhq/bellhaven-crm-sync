# Demo script (~2 minutes) and review run-through

The exercise asks for: a few proposals with their evidence, approve one, reject one, then the approved change
landing in the CRM browser. Polish doesn't matter; talking through the reasoning does.

## Before recording
- `python -m pipeline run`: the queue should show **26 pending** (if it was already run today, expect 0 new / 26 refreshed).
- Start the review app (`cd web && npm run dev`) and open http://localhost:3000. Enter your name at "Who's reviewing?".
- Open a second tab on the CRM browser (the app's "Open in CRM" links go there).
- Recorder (Loom / OBS / Xbox Game Bar `Win+Alt+R`) set to capture the browser window plus the microphone.

## Script
| Time | Show | Say (roughly) |
|---|---|---|
| 0:00 | Progress header (ring + segments, 26 cases) | "Every day this scrapes Bellhaven's site, matches the 35 communities to the CRM, and queues one case per facility. Nothing writes until I approve." |
| 0:15 | **Bellhaven of Tiffin** (CHOW) | "The site lists Tiffin as Bellhaven, but the CRM still has it under Cedar Trail. The SOP check shows $84k of revenue and $12.4k open AR, so we can't move it: approving creates a new Bellhaven account and points the old one at it. The old account stays exactly as is." → **Approve** (let the Undo toast run out) |
| 0:45 | **Bellhaven of Kettering** (3 duplicates) | "Three CRM records at one address, under three different parents. It keeps one, re-parents and renames it, and marks the other two as Inactive duplicates. The survivor tie-break is stated honestly: lowest account id." (Approve or just show.) |
| 1:05 | **Amberly Manor** (create, lookalike) | "There's an 'Amberly Manor' in the CRM, but it's in Colorado Springs. Address is identity, names are labels, so this is a new account, not a match." |
| 1:20 | **Bellhaven of Ashtabula** (optional PO Box) | "The CRM's billing street is a PO Box. Our policy is that a PO Box is a valid billing address, so I'm rejecting this one." → **Reject**, reason "PO Box is a valid billing address" |
| 1:35 | CRM browser: the new **Bellhaven of Tiffin** account, then the old Cedar Trail account | "Here's the new account under Bellhaven, and the old one is unchanged except chow_current_account, which points to it. The note records who approved it." |
| 1:50 | History tab (audit trail) | "Every decision is logged with who made it and how. If the pipeline runs again tomorrow, decided items never come back." |

## Review run-through (off camera, before the deadline)
Recommended decisions (I pre-checked every case against the data; the adversarial review agreed):
- **Approve:** all CHOW (Tiffin, Marietta), Sandusky (sold → CHOW link), re-parents (Lima, Findlay,
  Zanesville), duplicates (Kettering, Monroe, Port Clinton, Erie, Owosso), renames (Chesterton, Chagrin Falls,
  Willow Creek + 4 cosmetic), Portsmouth zip, creates (Batavia, Carlisle, Union Square, Amberly Manor), unlisted
  (Alliance, Coldwater).
- **Reject:** Ashtabula PO Box (policy: keep the billing PO Box).

After approving: `python -m pipeline run` again should report **0 new** cases, and everything decided stays
decided. Then check the end state: `python -m pipeline verify` (diff of the CRM against the expected outcomes).
