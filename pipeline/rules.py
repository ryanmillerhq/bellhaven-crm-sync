"""Every matching threshold and policy decision, in one place.

Approved by Ryan in docs/matching-outline.md (section 9). Most live changes are a one-line edit here.
"""

# --- who is the operator ---------------------------------------------------------------------------------------
OPERATOR_PARENT_NAME = "Bellhaven Senior Living"  # matched against parent accounts, ignoring "(Parent Account)"

# --- matching ----------------------------------------------------------------------------------------------------
# Address is identity: normalized street + state + (zip or city) equal is a match on its own.
# Without an address match, a candidate must pass the locality gate (same state AND same zip or city) AND show at
# least MIN_SUPPORTING_SIGNALS of: administrator contact match, phone match, name similarity >= NAME_MATCH_MIN.
NAME_MATCH_MIN = 90
BRAND_TOKENS = frozenset({"bellhaven"})  # ignored when scoring name similarity as a match signal (every name has it)
MIN_SUPPORTING_SIGNALS = 2
LOOKALIKE_MIN = 80  # non-matching accounts with names at least this similar are shown to the reviewer as "lookalikes"

# --- what counts as a change ----------------------------------------------------------------------------------------
PROPOSE_COSMETIC_RENAMES = True  # decision 1: propose the exact website name even for punctuation/spelling variants
COSMETIC_RENAME_MIN = 90  # names at least this similar (after normalization) are tagged "cosmetic"
SYNC_PHONE = False  # decision 2: phone is evidence only, never written
LEAVE_PO_BOX_STREETS = True  # decision 3: a PO Box billing street is legitimate; never bundled into another fix
PO_BOX_STREETS = "flag"  # "flag": separate optional case the reviewer can reject (default: keep) | "leave": silent
SYNC_CARE_TYPE = True  # only when the CRM care_type isn't one of the site's offerings

# --- outcomes --------------------------------------------------------------------------------------------------------
UNLISTED_STATUS = "Needs Review"  # decision 4: on Bellhaven but gone from the site, new owner unknown (parent kept)
CHOW_LINK_TO_EXISTING_OWNER_RECORD = True  # decision 5: if the new owner already has an account, link to it
MOVE_DUPLICATE_CONTACTS = True  # decision 6: re-point active contacts from duplicate losers to the survivor
NOTE_ON_CHOW_OLD_ACCOUNT = False  # decision 7: SOP says leave the old account exactly as is (only chow_current_account)

# --- CHOW SOP ---------------------------------------------------------------------------------------------------------
# A parent change on an account with billing history AND open AR must not touch that account: create a new one under
# the right parent and point the old one at it. Otherwise re-parent directly. null counts as "no history".
def sop_requires_chow(lifetime_revenue, outstanding_ar) -> bool:
    return (lifetime_revenue or 0) > 0 and (outstanding_ar or 0) > 0


# --- duplicate survivor order (decision 8 = rule 6 breaks the Kettering tie) ------------------------------------------
# 1 billing history  2 already under the operator  3 administrator match  4 phone match  5 most contacts
# 6 street formatted exactly like the site  7 lowest account_id (deterministic)
# If more than one duplicate has billing history, nothing is auto-picked: the reviewer decides (Needs Review).

# --- vocabulary ----------------------------------------------------------------------------------------------------------
CARE_TYPE_MAP = {
    "short-term rehabilitation & nursing": "Skilled Nursing",
    "short-term rehabilitation and nursing": "Skilled Nursing",
    "skilled nursing": "Skilled Nursing",
    "memory support": "Memory Care",
    "memory care": "Memory Care",
    "assisted living": "Assisted Living",
    "independent living": "Independent Living",
}

NOTE_TAG = "bellhaven-sync"

# --- scrape sanity ------------------------------------------------------------------------------------------------
# A scrape is "complete" (safe to conclude absence) only if no page failed, it meets the homepage's own count, and it
# isn't a collapse versus the last good run (small legitimate drops still pass).
MIN_SCRAPE_RATIO_VS_LAST_RUN = 0.9
