import type { IconName } from "@/components/icons";
import type { AccountRole, CaseKind, CaseStatus, Value } from "@/lib/types";

export const KIND: Record<CaseKind, { label: string; short: string; color: string; icon: IconName; blurb: string }> = {
  chow:       { label: "Change of ownership", short: "CHOW",      color: "#a855f7", icon: "swap",     blurb: "Preserve the billing account, create a new one under the right parent" },
  sold:       { label: "Sold to another operator", short: "Sold",  color: "#f472b6", icon: "flag",     blurb: "Not on the website; another operator's account exists at the address" },
  reparent:   { label: "Wrong parent",        short: "Re-parent", color: "#38bdf8", icon: "home",     blurb: "Move the account under the right parent company" },
  duplicate:  { label: "Duplicate accounts",  short: "Duplicates",color: "#f59e0b", icon: "copy",     blurb: "Several CRM accounts for one building" },
  rename:     { label: "Name update",         short: "Rename",    color: "#818cf8", icon: "edit",     blurb: "CRM name differs from the operator's published name" },
  field_fix:  { label: "Field fix",           short: "Field fix", color: "#2dd4bf", icon: "note",     blurb: "An address field differs from the website" },
  create:     { label: "Missing account",     short: "Create",    color: "#34d399", icon: "store",    blurb: "On the website, not in the CRM" },
  unlisted:   { label: "Not on website",      short: "Unlisted",  color: "#fb923c", icon: "warning",  blurb: "Under Bellhaven in the CRM, but no longer listed" },
  reactivate: { label: "Reactivate",          short: "Reactivate",color: "#a3e635", icon: "verified", blurb: "Listed live but inactive in the CRM" },
};

export const KIND_ORDER: CaseKind[] = ["chow", "sold", "duplicate", "reparent", "create", "rename", "field_fix", "unlisted", "reactivate"];

export const STATUS: Record<CaseStatus, { label: string; tone: string }> = {
  pending:    { label: "Pending",   tone: "bg-muted text-muted-foreground" },
  applying:   { label: "Applying",  tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  applied:    { label: "Applied",   tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  rejected:   { label: "Rejected",  tone: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300" },
  failed:     { label: "Failed",    tone: "bg-red-500/15 text-red-600 dark:text-red-300" },
  stale:      { label: "Stale",     tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  superseded: { label: "Superseded",tone: "bg-muted text-muted-foreground" },
};

export const ROLE: Record<AccountRole, { label: string; tone: string; hint: string }> = {
  target:           { label: "Matched account",  tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",            hint: "The CRM account this facility matched" },
  survivor:         { label: "Survivor",         tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", hint: "Kept as the one true record" },
  duplicate:        { label: "Duplicate",        tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",       hint: "Will point to the survivor and go Inactive" },
  old_record:       { label: "Old record",       tone: "bg-purple-500/15 text-purple-700 dark:text-purple-300",    hint: "Preserved as-is for billing" },
  new_owner_record: { label: "Current owner's record", tone: "bg-pink-500/15 text-pink-700 dark:text-pink-300",    hint: "The account the old one will point to" },
  lookalike:        { label: "Ruled out",        tone: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",          hint: "Looks similar but is a different facility" },
};

export const FIELD_LABEL: Record<string, string> = {
  name: "Name", parent_id: "Parent company", billing_street: "Street", billing_city: "City", billing_state: "State",
  billing_zip: "Zip", care_type: "Care type", phone: "Phone", status: "Status", note: "Note",
  duplicate_of_account: "Duplicate of", chow_current_account: "CHOW → current account", account_id: "Account",
};

export const PARENTS: Record<string, string> = {
  "0015QAPLGS3FVYEEEM": "Bellhaven Senior Living",
  "001FJZYHR7MLFMNPLL": "Harborview Care Group",
  "001FWSQ30SFW6S7604": "Cedar Trail Communities",
  "001YRHHXQ5HJ0TCL2U": "Millstone Health Partners",
  "001DAAUWV2J3SHQJ34": "Juniper Point Healthcare",
  "00139TNDS8HNLUZ5A6": "Stonebridge Eldercare",
};

export function isRef(v: unknown): v is { $ref: string } {
  return !!v && typeof v === "object" && "$ref" in (v as object);
}

export function displayValue(field: string, v: Value, names: Record<string, string>, refStep: Record<string, number>): string {
  if (isRef(v)) return refStep[v.$ref] ? `the new account from step ${refStep[v.$ref]}` : "the new account";
  if (v === null || v === "") return "—";
  const s = String(v);
  if (field === "parent_id") return PARENTS[s] ?? names[s] ?? s;
  if (field === "duplicate_of_account" || field === "chow_current_account" || field === "account_id") return names[s] ? `${names[s]} (${s})` : s;
  return s;
}
