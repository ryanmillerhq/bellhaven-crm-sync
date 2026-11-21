# Case contract (pipeline → review store → review app / MCP)

This is the shape of one row in `public.cases` (see [db/migrations/001_init_review_store.sql](../db/migrations/001_init_review_store.sql)).
The Python pipeline **produces** cases, and the review app and MCP server **consume** them. The app's executor
is generic: it runs `operations` in order and contains **no business rules**. All matching, CHOW and duplicate
logic is decided in the pipeline and shown to the reviewer as `reasoning`, `evidence` and `sop`.

```ts
type CaseKind = "chow" | "reparent" | "duplicate" | "rename" | "field_fix" | "create" | "sold" | "unlisted" | "reactivate";
type CaseStatus = "pending" | "applying" | "applied" | "rejected" | "failed" | "stale" | "superseded";

interface Case {
  id: number;
  fingerprint: string;              // idempotency key; never re-proposed once decided
  kind: CaseKind;                   // primary kind (drives the badge/color)
  tags: string[];                   // every change in the bundle, e.g. ["duplicate","reparent","rename"] or ["rename","cosmetic"]
  subject_key: string;              // "site:<slug>" | "account:<account_id>"
  title: string;                    // "Bellhaven of Tiffin"
  summary: string;                  // one line: "Change of ownership: still under Cedar Trail, with open AR"
  reasoning: string[];              // 2–4 plain-English bullets ("What we found")
  location: Location | null;        // scraped website record; null for account-sweep cases
  accounts: CaseAccount[];          // CRM records involved, snapshotted when proposed
  evidence: EvidenceRow[];          // website vs CRM, field by field
  sop: SopCheck | null;             // present when a parent change was considered
  confidence: "high" | "medium" | "low";
  operations: Operation[];          // what one-click Approve will do, in order
  preconditions: Precondition[];    // re-checked against live CRM right before writing
  status: CaseStatus;
  first_seen_run: number; last_seen_run: number;
  decided_at: string | null; decided_by: string | null; decided_via: "ui" | "mcp" | null; decision_note: string | null;
  final_operations: Operation[] | null;   // operations after reviewer edits, as executed
  result: OperationResult[] | null;       // per-operation outcome (makes retries resume-safe)
  error: string | null;
}

interface Location {               // = pipeline/models.py Location
  slug: string; url: string; name: string; street: string; city: string; state: string; zip: string;
  care_offerings: string[]; administrator: string; phone: string; found_on: string[];
}

interface CaseAccount {
  role: "target" | "survivor" | "duplicate" | "old_record" | "new_owner_record" | "lookalike";
  account: CrmAccount;              // full CRM account as read (fields as the API returns them)
  contacts: CrmContact[];
  match_signals?: string[];         // e.g. ["address", "administrator", "phone"]
}

interface EvidenceRow {
  field: string;                    // "name" | "parent" | "street" | "city" | "state" | "zip" | "care_type" | "phone" | "administrator" | "status"
  label: string;                    // "Parent company"
  website: string | null;
  crm: string | null;
  match: "same" | "formatting" | "different" | "missing";   // "formatting" = equal after normalization (Rd vs Road)
  account_id?: string;              // which account the CRM value came from (duplicates have several)
  note?: string;
}

interface SopCheck {
  account_id: string;
  lifetime_revenue: number; outstanding_ar: number;
  from_parent: string; to_parent: string;
  branch: "chow" | "reparent";
  explanation: string;              // "Has billing history ($84,000) AND open AR ($12,400) → SOP: keep the old account..."
}

type Value = string | number | boolean | null | { $ref: string };   // {$ref:"new"} → account_id created by an earlier op

type Operation =
  | { id: string; op: "create_account"; ref: string; fields: Record<string, Value>; editable: string[]; describe: string }
  | { id: string; op: "update_account"; account_id: string | { $ref: string }; fields: Record<string, Value>; editable: string[]; describe: string }
  | { id: string; op: "append_note";    account_id: string | { $ref: string }; text: string; describe: string }
  | { id: string; op: "move_contact";   contact_id: string; to_account_id: string | { $ref: string }; describe: string };

interface Precondition { account_id: string; field: string; equals: Value }  // e.g. parent_id still Cedar Trail; outstanding_ar still 12400

interface OperationResult { op_id: string; ok: boolean; at: string; response?: unknown; created_id?: string; error?: string }
```

## Executor rules (review app, `web/lib/cases.ts`)
1. **Claim** atomically: `update cases set status='applying' where id=$1 and status in ('pending','failed') returning *`.
2. **Re-check preconditions** with live `GET /accounts/{id}`. On any mismatch → `status='stale'`, plus an event
   saying which field drifted. Nothing is written.
3. **Run** `final_operations` (the reviewer's edits applied to `editable` fields only) in order:
   - `create_account` → `POST /accounts`; record `created_id` under `ref`.
   - `update_account` → `PATCH /accounts/{id}` with only the given fields.
   - `append_note` → read the current note, then `PATCH note = current + "\n" + text`. Never overwrite.
   - `move_contact` → `PATCH /contacts/{id}` with `{account_id}`.

   `{ $ref }` values resolve to ids created earlier in the same case. Ops whose `op_id` already has an `ok` result
   are skipped, so retrying a partially failed case never double-creates.
4. Finish with `status='applied'`, or `status='failed'` with `error`, which can be retried. Every transition is
   written to `case_events` (actor, via `ui` | `mcp`).

## Example: CHOW (Tiffin)
```json
{
  "kind": "chow", "tags": ["chow"], "subject_key": "site:bellhaven-of-tiffin", "title": "Bellhaven of Tiffin",
  "summary": "Change of ownership: listed by Bellhaven, but the CRM account is still under Cedar Trail with open AR",
  "sop": { "account_id": "001U6RW32TY0WSXZZB", "lifetime_revenue": 84000, "outstanding_ar": 12400,
           "from_parent": "Cedar Trail Communities", "to_parent": "Bellhaven Senior Living", "branch": "chow",
           "explanation": "Billing history ($84,000) and open AR ($12,400): per SOP the old account stays exactly as is, a new account is created under Bellhaven, and the old one points to it." },
  "operations": [
    { "id": "op1", "op": "create_account", "ref": "new", "editable": ["name","billing_street","billing_city","billing_state","billing_zip","care_type"],
      "fields": { "name": "Bellhaven of Tiffin", "parent_id": "0015QAPLGS3FVYEEEM", "billing_street": "45 St Lawrence Dr",
                  "billing_city": "Tiffin", "billing_state": "OH", "billing_zip": "44883", "care_type": "Skilled Nursing",
                  "phone": "(260) 589-2589", "status": "Active",
                  "note": "[bellhaven-sync 2026-11-21] Created for change of ownership from Cedar Trail. Predecessor 001U6RW32TY0WSXZZB kept for billing per CHOW SOP." },
      "describe": "Create “Bellhaven of Tiffin” under Bellhaven Senior Living" },
    { "id": "op2", "op": "update_account", "account_id": "001U6RW32TY0WSXZZB", "fields": { "chow_current_account": { "$ref": "new" } },
      "editable": [], "describe": "Point the old Cedar Trail account to the new one (chow_current_account); leave everything else untouched" }
  ],
  "preconditions": [
    { "account_id": "001U6RW32TY0WSXZZB", "field": "parent_id", "equals": "001FWSQ30SFW6S7604" },
    { "account_id": "001U6RW32TY0WSXZZB", "field": "lifetime_revenue", "equals": 84000 },
    { "account_id": "001U6RW32TY0WSXZZB", "field": "outstanding_ar", "equals": 12400 },
    { "account_id": "001U6RW32TY0WSXZZB", "field": "chow_current_account", "equals": "" }
  ]
}
```

## Other files the app reads
- `runs.match_results` (latest run) is an array of
  `{ subject_key, name, classification: "in_sync"|"case", account_id, account_name, confidence, signals: string[] }`.
  It feeds the **In sync** tab.
- CRM browser deep link: `${SITE_BASE_URL}/crm/${CRM_API_TOKEN}/accounts/${account_id}`. **The token must never
  reach the client**, so the link is served by a server-side redirect route.
