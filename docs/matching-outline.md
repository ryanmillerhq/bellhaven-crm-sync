# Matching logic outline (for Ryan's review)

> Status: **DRAFT, awaiting Ryan's corrections.** No matching code has been written yet.
> Grounded in a read-only pull of the real CRM (121 accounts, 67 contacts) and a full scrape of the website
> (35 communities). Section 9 lists the judgment calls I need you to confirm or overrule.

## 1. Core principle
**Address is identity; names are labels.** Ownership changes rename facilities ("Riverbend Manor Care Center" →
"Bellhaven of Chagrin Falls"), but the building doesn't move. So the physical address drives matching. Name,
phone and administrator only support it or break ties, and **a name alone never makes a match.** The CRM has
decoys that a name-matcher would fall for:
- "Amberly Manor" is a Juniper Point account in Colorado Springs, not the Hudson, OH community.
- "Union Square Senior Living" is a Juniper Point account at a different street in the same zip.

## 2. Pipeline shape
```
scrape 35 locations ─┐
                     ├─ normalize ─ candidate search ─ score ─ cluster (1 location → 0..N accounts)
CRM 121 accounts ────┘                                              │
                                  ┌─────────────────────────────────┴───────────────┐
                        per-LOCATION classification              per-ACCOUNT sweep (Bellhaven-parented
                        (sections 4–5)                           accounts matched to no location; section 6)
                                  └──────────────► action planner (SOP, sections 7–8) ─► one case per facility
```

## 3. Normalization and signals
- **Street:** lowercase, strip punctuation, USPS suffix and directional abbreviations (Road→rd, Avenue/Av→ave,
  Boulevard→blvd, Pike/Pk→pike, Northwest→nw, West→w, …). `1125 Logan Boulevard` ≡ `1125 Logan Blvd`.
- **Name:** lowercase, `&`→and, Rehab→rehabilitation, Centre→center, "Health Care"→healthcare, drop
  "the"/punctuation. Used for name *similarity* (rapidfuzz token-set ratio), not identity.
- **Care type map:** Short-Term Rehabilitation & Nursing → Skilled Nursing · Memory Support → Memory Care ·
  Assisted Living → Assisted Living.
- **Signals, strongest first:**

  | Signal | Strength | Notes |
  |---|---|---|
  | Street (normalized) + zip equal | **Strong**: decisive | 33 of 35 locations hit at least one account this way |
  | Administrator on site = an Administrator contact on the account | Strong, supporting | e.g. Owosso: Gloria Lambert |
  | Phone equal | Supporting | Only ~half of CRM phones match the site, so used as evidence only |
  | Name similarity ≥ 90 | Supporting | Never sufficient alone |
  | Same city/state/zip | Gate | A candidate must share the state and the zip or city |

- **Match rule:** address match, **OR** (zip/city gate passes **AND** at least 2 of {administrator, phone,
  name ≥ 90}).
  - That second path catches **Ashtabula**, whose CRM billing street is "PO Box 517" but zip, phone and name all match.
  - Confidence: High = address + ≥1 supporting signal. Medium = address only, or the non-address path.

## 4. Per-location classification (decision tree)
```
matched accounts for this location?
├─ 0 ─────────────► MISSING → create the account under Bellhaven
├─ ≥2 ────────────► DUPLICATES → choose survivor (section 5); losers → duplicate_of_account + Inactive
│                   └─ then run the survivor through the 1-account checks below (same case)
└─ 1 (or survivor)
   ├─ parent ≠ Bellhaven ─► PARENT MOVE → SOP (section 7): CHOW if revenue>0 AND AR>0, else re-parent
   ├─ name ≠ site name ───► RENAME (rebrand vs cosmetic, section 9 decision #1)
   ├─ zip/city/state/street differ beyond formatting, or care_type not among site offerings ─► FIELD FIX
   ├─ status Inactive while listed live ─► REACTIVATE (none today, handled anyway)
   └─ nothing differs ───► CONFIDENT MATCH (no proposal; shown under "In sync")
```
A facility gets **one case** that bundles all of its changes, e.g. Zanesville = re-parent + rename. The reviewer
confirms the bundle with one click and can edit the fields first.

## 5. Duplicate survivor rule (ordered tie-breakers)
1. Has billing history (`lifetime_revenue > 0` or `outstanding_ar > 0`); billing must stay intact. If several
   do → no auto-pick; the case goes to the reviewer with status Needs Review.
2. Already under the correct parent (Bellhaven).
3. Administrator contact matches the site, then phone matches the site.
4. Most contacts.
5. Street matches the site's exact formatting.
6. Lowest `account_id` (deterministic).

Losers get `duplicate_of_account = survivor` and `status = Inactive`, plus an appended note. Their parent is
untouched: marking a duplicate isn't a re-parent, so the SOP isn't triggered.

## 6. Per-account sweep (Bellhaven-parented, matched to no location)
- **Same address as an account under another parent → SOLD.** The other account is the new owner's record.
  - Revenue > 0 AND AR > 0 → CHOW: set `chow_current_account` on the old account = the **existing** new-owner
    account (decision #5).
  - Otherwise → mark it a duplicate of the new-owner account (Inactive), so the facility isn't counted twice.
- **No other account at that address → UNLISTED:** `status = Needs Review` + note "no longer listed on
  bellhavenseniorliving site as of <date>; new owner unknown". Parent unchanged (decision #4).

## 7. CHOW SOP (applied to every parent change, including "no parent → Bellhaven")
| `lifetime_revenue` | `outstanding_ar` | Action |
|---|---|---|
| > 0 | > 0 | **Do not touch the parent.** Create a new account under the correct parent (website data), then set `chow_current_account` on the OLD account = new id. Old account otherwise left exactly as is. |
| > 0 | 0 | Re-parent directly |
| 0 | > 0 | Re-parent directly |
| 0 / null | 0 / null | Re-parent directly |

The executor re-checks revenue/AR at approval time. If the branch would flip, the case goes **stale** instead of
writing.

**Decoys I'll make sure we don't trip on:** Akron (rev $101k / AR $9k), Defiance, Meadville and New Carlisle all
have revenue and AR but are **already under Bellhaven**. No parent move means no CHOW.

## 8. Field policy
- **Synced from the site:** name, parent, billing street/city/state/zip, and care_type (only when the CRM value
  isn't one of the site's mapped offerings). New accounts get all site fields + phone.
- **Not changes:** formatting-only address differences (Road vs Rd).
- **Not synced:** phone (decision #2), PO Box billing street (decision #3).

## 9. Decisions for Ryan (my recommendation first)
1. **Cosmetic name differences** (Dayton "Arbors at Bellhaven Dayton", Ashland "Health Care Center" vs
   "Healthcare Centre", Grove City "Rehab and" vs "Rehabilitation &", "of" vs "at Sycamore Ridge"):
   **propose renaming to the exact website name, tagged "cosmetic"** — or treat them as in sync.
2. **Phone:** **don't sync; evidence only.** It isn't in the exercise's required scrape fields, and ~17 of 35
   differ, which would mostly add review noise. Alternative: sync it to the site value.
3. **Ashtabula "PO Box 517" billing street:** **leave it.** A billing PO box is legitimate, and the field is
   *billing* street. Alternative: overwrite with the site's physical address.
4. **Unlisted (Alliance, Coldwater):** **Needs Review + note, parent unchanged.** There's no evidence of who owns
   them now. Alternatives: set Inactive, or detach the parent.
5. **Sandusky** (Bellhaven account, rev $130k / AR $5.2k; a Millstone account exists at the same address):
   **CHOW-link the old account to the existing Millstone account.** The SOP's intent is "preserve the old
   account, point to the current one", and creating a second Millstone account would manufacture a duplicate.
   Alternative: the literal reading, i.e. create a new Millstone account.
6. **Contacts on duplicate losers** (only Owosso: Tricia Lindqvist, Admissions Director): **re-point active
   contacts to the survivor**, so they don't vanish onto an Inactive record. Alternative: leave them.
7. **CHOW old account:** **set only `chow_current_account`** (strict "leave exactly as it is"), with the
   explanatory note on the NEW account. Alternative: also append a note to the old account.
8. **Kettering survivor** (three accounts, all rev/AR 0, none under Bellhaven, no contacts, no phone match):
   the rule picks **Kettering Nursing & Rehabilitation** (no parent, exact street, lowest id). Alternative:
   prefer the Harborview record, since Bellhaven acquired all of Harborview in 2025.

## 10. Every case traced against the real data
| # | Facility | Case | What happens (one click) |
|---|---|---|---|
| 1 | Bellhaven of Tiffin | **CHOW** (Cedar Trail, rev $84k / AR $12.4k) | Create "Bellhaven of Tiffin" under Bellhaven; old `001U6RW…`.chow_current_account = new |
| 2 | Bellhaven of Marietta | **CHOW** (Cedar Trail, rev $51k / AR $3.8k) | Same pattern |
| 3 | Bellhaven of Sandusky | **SOLD → CHOW** (not on site; Millstone account at same address) | Old `001SXSF…`.chow_current_account = Millstone Care of Sandusky `0017JP8…` |
| 4 | Bellhaven Crossings of Lima | **Re-parent** (Harborview, rev $47k / AR 0) | parent → Bellhaven |
| 5 | Bellhaven Meadows of Findlay | **Re-parent** (no parent, rev $22k / AR 0; homepage-only listing) | parent → Bellhaven |
| 6 | Bellhaven of Zanesville | **Re-parent + rename** (Cedar Trail "Cedar Trail of Zanesville", rev 0) | parent → Bellhaven, name → site |
| 7 | Bellhaven of Kettering | **Duplicates ×3 + re-parent + rename** | Survivor (decision #8) → Bellhaven + renamed; other two → duplicate_of + Inactive |
| 8 | Bellhaven Gardens of Monroe | **Duplicates ×3** | Survivor = Bellhaven record; "Cedar Trail of Monroe" + "Monroe Gardens Care Center" (Harborview) → dup + Inactive |
| 9 | Bellhaven of Port Clinton | **Duplicate** | Harborview "…Nursing & Rehab of Port Clinton" → dup + Inactive |
| 10 | Bellhaven Shores of Erie | **Duplicate** | "Harborview Shores of Erie" → dup + Inactive |
| 11 | Bellhaven of Owosso | **Duplicate** (two Bellhaven records) | Survivor `001EGU7…` (phone + administrator match); `001QU15…` → dup + Inactive (+ contact move, decision #6) |
| 12 | Bellhaven of Chesterton | **Rename** ("Chesterton Senior Commons") | name → site |
| 13 | Bellhaven of Chagrin Falls | **Rename** ("Riverbend Manor Care Center") | name → site |
| 14 | Bellhaven Willow Creek | **Rename** ("Sunny Acres Retirement Home") | name → site |
| 15 | Bellhaven of Portsmouth | **Field fix** (zip 45626 → 45662, transposed digits) | zip → site |
| 16–19 | Dayton · Ashland · Grove City · Sycamore Ridge | **Cosmetic rename** (decision #1) | name → exact site name |
| 20 | Bellhaven of Batavia | **Missing** | Create under Bellhaven |
| 21 | Bellhaven of Carlisle (PA) | **Missing** | Create under Bellhaven |
| 22 | Bellhaven at Union Square | **Missing** (Juniper "Union Square Senior Living" is a different facility: other street, phone, administrator) | Create under Bellhaven |
| 23 | Amberly Manor (Hudson, OH) | **Missing** (Juniper "Amberly Manor" is in Colorado Springs) | Create under Bellhaven |
| 24 | Bellhaven Care Center of Alliance | **Unlisted** | Needs Review + note |
| 25 | Bellhaven of Coldwater | **Unlisted** | Needs Review + note |
| — | 13 others | **Confident match**, nothing to change | "In sync": Maplewood, New Carlisle, Wooster, Akron, Saline, Goshen, Meadville, Defiance, Toledo, Marion, Kalamazoo, Altoona, Ashtabula |

**Totals:** 35 locations = 13 in sync + 18 cases + 4 creates, plus 3 account-sweep cases → **25 review cases**
(21 if cosmetic renames count as in sync).

## 11. Idempotency and the live change
- **Re-runs:** each case gets a fingerprint (kind + subject + desired values). Decided cases (approved or
  rejected) are never re-proposed. Approved changes simply stop showing up, because the CRM now matches.
- **Live change:** every threshold, the survivor order, the field policy (`SYNC_PHONE`, `COSMETIC_RENAMES`) and
  the normalization maps live in one `RULES` block in `pipeline/rules.py`. Most likely live edits are one-line changes.
