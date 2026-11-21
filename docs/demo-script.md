# Demo script (~2 minutes) and review run-through

The exercise asks for: a few proposals with their evidence, approve one, reject one, then the approved change
landing in the CRM browser. Polish doesn't matter; talking through the reasoning does.

## Before recording (off camera)
1. Open http://localhost:3210 and enter your name at **"Who's reviewing?"**.
2. **Warm-up approvals** (confirm the CRM accepts our create + update before recording):
   - http://localhost:3210/?case=81: **Bellhaven of Batavia** (create) → Approve, let the 5s Undo run out
   - http://localhost:3210/?case=53: **Grove City** rename → Approve
   - Both should show as applied in the **History** tab. If either shows an error, paste it to Claude.
3. **Pre-open one browser tab per shot**, in this order (each link jumps straight to that case):

| Tab | Link | Case |
|---|---|---|
| 1 | http://localhost:3210/?case=79 | Bellhaven of Tiffin (CHOW) |
| 2 | http://localhost:3210/?case=59 | Bellhaven of Kettering (3 duplicates) |
| 3 | http://localhost:3210/?case=84 | Amberly Manor (create; Colorado Springs lookalike) |
| 4 | http://localhost:3210/?case=67 | Bellhaven of Ashtabula (optional PO Box → Reject) |
| 5 | http://localhost:3210/crm/001U6RW32TY0WSXZZB | Old Cedar Trail "Bellhaven of Tiffin" in the CRM browser |

   Press **F5** when you switch tabs so the progress counts are current (optional; decisions are always re-checked
   on the server).
4. Recorder (Loom / OBS / Xbox Game Bar `Win+Alt+R`) set to capture the browser window plus the microphone.

## Script (≈2 min)
| Time | Tab | Do | Say (roughly) |
|---|---|---|---|
| 0:00 | 1 | Point at the progress ring and segments | "Every day this scrapes Bellhaven's site, matches the 35 communities to the CRM, and queues one case per facility. Nothing writes until I approve." |
| 0:15 | 1 | Walk Tiffin's evidence → SOP check → the 2 steps; **Approve** (let Undo run out) | "The site lists Tiffin as Bellhaven, but the CRM has it under Cedar Trail with $84k revenue and $12.4k open AR. Per the SOP we don't move it: approving creates a new Bellhaven account and points the old one at it." |
| 0:45 | 2 | Show the 3 records + survivor reason; **Approve** | "Three records at one address under three parents. It keeps one, re-parents and renames it, and marks the other two as Inactive duplicates. The tie-break is stated honestly." |
| 1:05 | 3 | Point at the lookalike line; **Approve** | "There's an 'Amberly Manor' in the CRM, but it's in Colorado Springs. Address is identity, so this is a new account." |
| 1:20 | 4 | **Reject** with reason "PO Box is a valid billing address" | "Optional case: the billing street is a PO Box, and our policy keeps it, so I'm rejecting." |
| 1:35 | 5 | F5: the old account now shows CHOW → the new account; click through to the new Bellhaven of Tiffin | "The old account is untouched except the CHOW pointer, and the new one sits under Bellhaven, with a note saying who approved it." |
| 1:50 | 1 | **History** tab | "Every decision is logged with who made it and how, and a re-run tomorrow won't re-propose anything decided." |

## Review run-through (off camera, before the deadline)
Recommended decisions (I pre-checked every case against the data; the adversarial review agreed):
- **Approve:** all CHOW (Tiffin, Marietta), Sandusky (sold → CHOW link), re-parents (Lima, Findlay,
  Zanesville), duplicates (Kettering, Monroe, Port Clinton, Erie, Owosso), renames (Chesterton, Chagrin Falls,
  Willow Creek + 4 cosmetic), Portsmouth zip, creates (Batavia, Carlisle, Union Square, Amberly Manor), unlisted
  (Alliance, Coldwater).
- **Reject:** Ashtabula PO Box (policy: keep the billing PO Box).

After approving: `python -m pipeline run` again should report **0 new** cases, and everything decided stays
decided. Then check the end state: `python -m pipeline verify` (diff of the CRM against the expected outcomes).

## Optional: MCP demo (~60s clip, or the live walkthrough)
1. Keep the review app running at http://localhost:3210.
2. New terminal: `cd C:\clipboard-takehome-project` then `claude`. Approve the project MCP server
   **bellhaven-review** when asked, then run `/mcp` to confirm it's connected (10 tools). Use the **default
   permission mode**, so every write shows a permission prompt: that prompt is the human approval.
3. Ask:
   - "What's left in the Bellhaven review queue?" → `get_progress` / `list_cases`
   - "Walk me through the Owosso case. Do you agree with the survivor choice?" → `get_case`
   - "Approve it." → `approve_case` → **you confirm the permission prompt**
   - (optional) "Do a dry run of the pipeline." → `run_pipeline` (dry run: nothing saved, nothing written)
4. Browser → **History**: "Approved by Ryan Miller (via Claude MCP) · via MCP". Then open the record in the CRM.

Use a case that hasn't been approved yet (Owosso, `?case=68`), and do this before approving the rest in the UI.
