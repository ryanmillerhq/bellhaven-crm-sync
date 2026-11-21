// Shapes from docs/case-contract.md. The pipeline produces these, the app consumes them.

export type CaseKind =
  | "chow" | "reparent" | "duplicate" | "rename" | "field_fix" | "create" | "sold" | "unlisted" | "reactivate";
export type CaseStatus = "pending" | "applying" | "applied" | "rejected" | "failed" | "stale" | "superseded";

export type Ref = { $ref: string };
export type Value = string | number | boolean | null | Ref;

export interface CrmAccount {
  account_id: string;
  name: string;
  parent_id: string;
  parent_name: string;
  billing_street: string;
  billing_city: string;
  billing_state: string;
  billing_zip: string;
  care_type: string;
  phone: string;
  status: string;
  lifetime_revenue: number;
  outstanding_ar: number;
  duplicate_of_account: string;
  chow_current_account: string;
  note: string;
  created_by_candidate?: boolean;
  updated_at?: string;
  [k: string]: unknown;
}

export interface CrmContact {
  contact_id: string;
  account_id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_active: boolean;
  [k: string]: unknown;
}

export interface Location {
  slug: string; url: string; name: string; street: string; city: string; state: string; zip: string;
  care_offerings: string[]; administrator: string; phone: string; found_on: string[];
}

export type AccountRole = "target" | "survivor" | "duplicate" | "old_record" | "new_owner_record" | "lookalike";

export interface CaseAccount {
  role: AccountRole;
  account: CrmAccount;
  contacts: CrmContact[];
  match_signals?: string[];
}

export interface EvidenceRow {
  field: string;
  label: string;
  website: string | null;
  crm: string | null;
  match: "same" | "formatting" | "different" | "missing";
  account_id?: string;
  note?: string;
}

export interface SopCheck {
  account_id: string;
  lifetime_revenue: number;
  outstanding_ar: number;
  from_parent: string;
  to_parent: string;
  branch: "chow" | "reparent";
  explanation: string;
}

export type Operation =
  | { id: string; op: "create_account"; ref: string; fields: Record<string, Value>; editable: string[]; describe: string }
  | { id: string; op: "update_account"; account_id: string | Ref; fields: Record<string, Value>; editable: string[]; describe: string }
  | { id: string; op: "append_note"; account_id: string | Ref; text: string; describe: string }
  | { id: string; op: "move_contact"; contact_id: string; to_account_id: string | Ref; describe: string };

export interface Precondition { account_id: string; field: string; equals: Value }

export interface OperationResult {
  op_id: string; ok: boolean; at: string;
  /** Who ran this step and through which surface. The CRM only sees one shared token, so this is the record. */
  actor: string; via: "ui" | "mcp";
  response?: unknown; created_id?: string; error?: string;
}

export interface Case {
  id: number;
  fingerprint: string;
  kind: CaseKind;
  tags: string[];
  subject_key: string;
  title: string;
  summary: string | null;
  reasoning: string[];
  location: Location | null;
  accounts: CaseAccount[];
  evidence: EvidenceRow[];
  sop: SopCheck | null;
  confidence: "high" | "medium" | "low" | null;
  operations: Operation[];
  preconditions: Precondition[];
  status: CaseStatus;
  first_seen_run: number | null;
  last_seen_run: number | null;
  decided_at: string | null;
  decided_by: string | null;
  decided_via: "ui" | "mcp" | null;
  decision_note: string | null;
  final_operations: Operation[] | null;
  result: OperationResult[] | null;
  error: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CaseEvent {
  id: number; case_id: number; at: string; event: string; actor: string | null; via: string | null; detail: unknown;
}

export interface MatchResult {
  subject_key: string;
  name: string;
  classification: "in_sync" | "case";
  account_id: string | null;
  account_name: string | null;
  confidence: string | null;
  signals: string[];
}

export interface Run {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: "manual" | "schedule" | "ci";
  status: "running" | "succeeded" | "failed";
  location_count: number | null;
  account_count: number | null;
  summary: Record<string, unknown>;
  match_results: MatchResult[] | null;
  error: string | null;
}

export interface Progress {
  total: number;
  decided: number;
  pending: number;
  applied: number;
  rejected: number;
  attention: number; // failed + stale + applying
  byKind: Record<string, { total: number; decided: number }>;
}

/** Field edits keyed by operation id, applied only to that operation's `editable` fields. */
export type Edits = Record<string, Record<string, string>>;

export interface Actor { name: string; via: "ui" | "mcp" }
