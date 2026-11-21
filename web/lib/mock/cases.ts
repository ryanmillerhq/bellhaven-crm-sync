/**
 * Mock review queue for DATA_SOURCE=mock, built from the REAL pre-change CRM export and website scrape
 * (lib/mock/snapshot.json, generated from data/). It mirrors the cases traced in docs/matching-outline.md §10,
 * so the UI and the executor can be exercised end to end with zero real CRM or database writes.
 * The real pipeline (pipeline/) produces the same shapes into Supabase.
 */
import snapshot from "./snapshot.json";
import type {
  AccountRole, Case, CaseAccount, CaseEvent, CaseKind, CrmAccount, CrmContact, EvidenceRow, Location, MatchResult, Operation,
  Precondition, Run, SopCheck,
} from "../types";

export const BELLHAVEN_ID = "0015QAPLGS3FVYEEEM";
const BELLHAVEN = "Bellhaven Senior Living";
const TODAY = "2026-11-21";
const tag = `[bellhaven-sync ${TODAY}]`;

const SNAP = snapshot as unknown as { accounts: CrmAccount[]; contacts: CrmContact[]; locations: Location[] };
export const snapshotAccounts = () => structuredClone(SNAP.accounts);
export const snapshotContacts = () => structuredClone(SNAP.contacts);

const acct = (id: string) => {
  const a = SNAP.accounts.find((x) => x.account_id === id);
  if (!a) throw new Error(`mock: account ${id} not in snapshot`);
  return structuredClone(a);
};
const loc = (slug: string) => {
  const l = SNAP.locations.find((x) => x.slug === slug);
  if (!l) throw new Error(`mock: location ${slug} not in snapshot`);
  return structuredClone(l);
};
const contactsOf = (id: string) => SNAP.contacts.filter((c) => c.account_id === id).map((c) => structuredClone(c));
const parentLabel = (a: CrmAccount) => (a.parent_name || "").replace(/\s*\(Parent Account\)\s*$/, "") || "(no parent)";

// ---------- normalization used only to label evidence rows ("formatting only" vs real difference) ----------
const ABBR: Record<string, string> = {
  street: "st", road: "rd", avenue: "ave", av: "ave", drive: "dr", boulevard: "blvd", lane: "ln", pike: "pike", pk: "pike",
  north: "n", south: "s", east: "e", west: "w", northwest: "nw", northeast: "ne", southwest: "sw", southeast: "se",
};
const normStreet = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map((t) => ABBR[t] ?? t).join(" ");
const normName = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/\brehab\b/g, "rehabilitation").replace(/centre/g, "center")
    .replace(/health care/g, "healthcare").replace(/\bthe\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const CARE: Record<string, string> = {
  "Short-Term Rehabilitation & Nursing": "Skilled Nursing", "Memory Support": "Memory Care", "Assisted Living": "Assisted Living",
};
const careTypes = (l: Location) => l.care_offerings.map((o) => CARE[o] ?? o);
const digits = (s: string) => s.replace(/\D/g, "");

function cmp(a: string, b: string, norm?: (s: string) => string): EvidenceRow["match"] {
  if (!a && !b) return "same";
  if (!a || !b) return "missing";
  if (a.trim() === b.trim()) return "same";
  if (norm && norm(a) === norm(b)) return "formatting";
  return "different";
}

function evidence(l: Location, a: CrmAccount, expectParent = BELLHAVEN): EvidenceRow[] {
  const admin = contactsOf(a.account_id).find((c) => c.title === "Administrator");
  const rows: EvidenceRow[] = [
    { field: "name", label: "Name", website: l.name, crm: a.name, match: cmp(l.name, a.name, normName) },
    { field: "parent", label: "Parent company", website: expectParent, crm: parentLabel(a), match: parentLabel(a) === expectParent ? "same" : "different" },
    { field: "street", label: "Street", website: l.street, crm: a.billing_street, match: cmp(l.street, a.billing_street, normStreet) },
    { field: "city", label: "City", website: l.city, crm: a.billing_city, match: cmp(l.city, a.billing_city) },
    { field: "state", label: "State", website: l.state, crm: a.billing_state, match: cmp(l.state, a.billing_state) },
    { field: "zip", label: "Zip", website: l.zip, crm: a.billing_zip, match: cmp(l.zip, a.billing_zip) },
    {
      field: "care_type", label: "Care type", website: l.care_offerings.join(", "), crm: a.care_type || null,
      match: careTypes(l).includes(a.care_type) ? "same" : a.care_type ? "different" : "missing",
      note: careTypes(l).includes(a.care_type) ? "Website wording maps to this CRM care type" : undefined,
    },
    {
      field: "phone", label: "Phone", website: l.phone, crm: a.phone,
      match: digits(l.phone) === digits(a.phone) ? "same" : "different", note: "Evidence only; phone isn't synced",
    },
    {
      field: "administrator", label: "Administrator", website: l.administrator, crm: admin?.name ?? null,
      match: !admin ? "missing" : admin.name === l.administrator ? "same" : "different",
      note: admin ? "From the account's Administrator contact" : "No Administrator contact on this account",
    },
  ];
  return rows.map((r) => ({ ...r, account_id: a.account_id }));
}

function sop(a: CrmAccount, toParent = BELLHAVEN): SopCheck {
  const rev = Number(a.lifetime_revenue) || 0;
  const ar = Number(a.outstanding_ar) || 0;
  const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
  const chow = rev > 0 && ar > 0;
  return {
    account_id: a.account_id, lifetime_revenue: rev, outstanding_ar: ar, from_parent: parentLabel(a), to_parent: toParent,
    branch: chow ? "chow" : "reparent",
    explanation: chow
      ? `Billing history (${usd(rev)}) AND open AR (${usd(ar)}). Per the CHOW SOP the old account stays exactly as it is for billing; a new account is created under ${toParent} and the old one points to it.`
      : rev > 0
        ? `Billing history (${usd(rev)}) but no open AR, so the SOP allows re-parenting the existing account directly.`
        : ar > 0
          ? `Open AR (${usd(ar)}) but no revenue history, so the SOP allows re-parenting the existing account directly.`
          : `No billing history and no open AR, so the existing account is re-parented directly.`,
  };
}

const role = (r: AccountRole, a: CrmAccount, signals?: string[]): CaseAccount => ({ role: r, account: a, contacts: contactsOf(a.account_id), match_signals: signals });

function fingerprint(kind: string, subject: string, desired: unknown) {
  const s = `${kind}|${subject}|${JSON.stringify(desired)}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `mock-${h.toString(16)}`;
}

let nextId = 1;
type Draft = {
  kind: CaseKind; tags: string[]; subject_key: string; title: string; summary: string; reasoning: string[];
  location: Location | null; accounts: CaseAccount[]; evidence: EvidenceRow[]; sop?: SopCheck | null;
  confidence: Case["confidence"]; operations: Operation[]; preconditions: Precondition[];
};
function mk(d: Draft): Case {
  return {
    id: nextId++, fingerprint: fingerprint(d.kind, d.subject_key, d.operations), sop: null, ...d,
    status: "pending", first_seen_run: 1, last_seen_run: 1, decided_at: null, decided_by: null, decided_via: null,
    decision_note: null, final_operations: null, result: null, error: null,
    created_at: `${TODAY}T19:40:00.000Z`, updated_at: `${TODAY}T19:40:00.000Z`,
  };
}

const ADDRESS_FIELDS = ["name", "billing_street", "billing_city", "billing_state", "billing_zip", "care_type"];
const siteFields = (l: Location) => ({
  name: l.name, parent_id: BELLHAVEN_ID, billing_street: l.street, billing_city: l.city, billing_state: l.state,
  billing_zip: l.zip, care_type: careTypes(l)[0] ?? "", phone: l.phone, status: "Active",
});

// ---------------------------------------------- case builders ----------------------------------------------

function chowCase(slug: string, oldId: string): Case {
  const l = loc(slug), old = acct(oldId), s = sop(old);
  return mk({
    kind: "chow", tags: ["chow"], subject_key: `site:${slug}`, title: l.name,
    summary: `Change of ownership: Bellhaven lists it, but the CRM account is still under ${s.from_parent} with open AR`,
    reasoning: [
      `${l.name} is on Bellhaven's website (${l.street}, ${l.city}) and matches CRM account ${old.account_id} on street address and zip.`,
      `That account still sits under ${s.from_parent}; Bellhaven announced it acquired select ${s.from_parent} communities in 2026.`,
      `It has billing history and open AR, so the CHOW SOP applies: don't re-parent; create a new Bellhaven account and link the old one to it.`,
    ],
    location: l, accounts: [role("old_record", old, ["address", "name"])], evidence: evidence(l, old), sop: s, confidence: "high",
    operations: [
      { id: "op1", op: "create_account", ref: "new", editable: ADDRESS_FIELDS,
        fields: { ...siteFields(l), note: `${tag} Created for change of ownership from ${s.from_parent}. Predecessor ${old.account_id} kept for billing per CHOW SOP.` },
        describe: `Create “${l.name}” under ${BELLHAVEN} with the website's address and care type` },
      { id: "op2", op: "update_account", account_id: old.account_id, fields: { chow_current_account: { $ref: "new" } }, editable: [],
        describe: `Point the old ${s.from_parent} account to the new one (chow_current_account); leave everything else untouched` },
    ],
    preconditions: [
      { account_id: old.account_id, field: "parent_id", equals: old.parent_id },
      { account_id: old.account_id, field: "lifetime_revenue", equals: old.lifetime_revenue },
      { account_id: old.account_id, field: "outstanding_ar", equals: old.outstanding_ar },
      { account_id: old.account_id, field: "chow_current_account", equals: "" },
    ],
  });
}

function soldCase(oldId: string, ownerId: string): Case {
  const old = acct(oldId), owner = acct(ownerId), s = sop(old, parentLabel(owner));
  return mk({
    kind: "sold", tags: ["sold", "chow"], subject_key: `account:${oldId}`, title: old.name,
    summary: `No longer on Bellhaven's website; a ${parentLabel(owner)} account already exists at the same address`,
    reasoning: [
      `${old.name} is under Bellhaven in the CRM but is not among the 35 communities on Bellhaven's website.`,
      `${owner.name} (${parentLabel(owner)}) is at the identical address (${owner.billing_street}, ${owner.billing_city} ${owner.billing_zip}), so the facility changed hands.`,
      `The Bellhaven account has billing history and open AR, so per the CHOW SOP it stays as is and points to the existing ${parentLabel(owner)} account. Creating another one would manufacture a duplicate.`,
    ],
    location: null, accounts: [role("old_record", old, ["address"]), role("new_owner_record", owner, ["address"])],
    evidence: [
      { field: "listed", label: "On Bellhaven's website", website: "Not listed", crm: "Under Bellhaven", match: "different", account_id: oldId },
      { field: "street", label: "Street", website: owner.billing_street, crm: old.billing_street, match: cmp(owner.billing_street, old.billing_street, normStreet), account_id: oldId, note: `Left: ${owner.name}` },
      { field: "zip", label: "Zip", website: owner.billing_zip, crm: old.billing_zip, match: cmp(owner.billing_zip, old.billing_zip), account_id: oldId },
      { field: "parent", label: "Parent company", website: parentLabel(owner), crm: parentLabel(old), match: "different", account_id: oldId },
    ],
    sop: s, confidence: "high",
    operations: [
      { id: "op1", op: "update_account", account_id: oldId, fields: { chow_current_account: ownerId }, editable: [],
        describe: `Point ${old.name} to ${owner.name} (chow_current_account); leave everything else untouched` },
      { id: "op2", op: "append_note", account_id: ownerId,
        text: `${tag} Current account for the facility formerly tracked as ${old.name} (${oldId}), kept for billing per CHOW SOP.`,
        describe: `Add a note on ${owner.name} explaining the link` },
    ],
    preconditions: [
      { account_id: oldId, field: "parent_id", equals: old.parent_id },
      { account_id: oldId, field: "outstanding_ar", equals: old.outstanding_ar },
      { account_id: oldId, field: "chow_current_account", equals: "" },
      { account_id: ownerId, field: "parent_id", equals: owner.parent_id },
    ],
  });
}

function reparentCase(slug: string, id: string, opts: { rename?: boolean } = {}): Case {
  const l = loc(slug), a = acct(id), s = sop(a);
  const fields: Record<string, string> = { parent_id: BELLHAVEN_ID };
  if (opts.rename) fields.name = l.name;
  return mk({
    kind: "reparent", tags: opts.rename ? ["reparent", "rename"] : ["reparent"], subject_key: `site:${slug}`, title: l.name,
    summary: `Wrong parent: ${s.from_parent} → ${BELLHAVEN}${opts.rename ? `, renamed from “${a.name}”` : ""}`,
    reasoning: [
      `${l.name} is on Bellhaven's website${l.found_on.includes("homepage") && l.found_on.length === 1 ? " (linked only from the homepage's “New this year” notice)" : ""} and matches ${a.account_id} on street address and zip.`,
      `The CRM has it under ${s.from_parent}.`,
      s.explanation,
      ...(opts.rename ? [`The CRM still uses the old name “${a.name}”; the website now calls it “${l.name}”.`] : []),
    ],
    location: l, accounts: [role("target", a, ["address"])], evidence: evidence(l, a), sop: s, confidence: "high",
    operations: [
      { id: "op1", op: "update_account", account_id: id, fields, editable: opts.rename ? ["name"] : [],
        describe: `Move to ${BELLHAVEN}${opts.rename ? ` and rename to “${l.name}”` : ""}` },
      { id: "op2", op: "append_note", account_id: id, text: `${tag} Re-parented from ${s.from_parent} to ${BELLHAVEN} per website listing (${l.url}).`,
        describe: "Add an explanatory note (appended, never overwritten)" },
    ],
    preconditions: [
      { account_id: id, field: "parent_id", equals: a.parent_id },
      { account_id: id, field: "outstanding_ar", equals: a.outstanding_ar },
      { account_id: id, field: "lifetime_revenue", equals: a.lifetime_revenue },
    ],
  });
}

function duplicateCase(slug: string, survivorId: string, dupIds: string[], opts: { reparent?: boolean; rename?: boolean; moveContacts?: boolean; why: string }): Case {
  const l = loc(slug), surv = acct(survivorId), dups = dupIds.map(acct);
  const ops: Operation[] = [];
  const pre: Precondition[] = [];
  const survFields: Record<string, string> = {};
  if (opts.reparent) survFields.parent_id = BELLHAVEN_ID;
  if (opts.rename) survFields.name = l.name;
  if (Object.keys(survFields).length) {
    ops.push({ id: "op1", op: "update_account", account_id: survivorId, fields: survFields, editable: opts.rename ? ["name"] : [],
      describe: `Keep ${surv.account_id} as the surviving record: ${opts.reparent ? `move it to ${BELLHAVEN}` : ""}${opts.reparent && opts.rename ? " and " : ""}${opts.rename ? `rename it “${l.name}”` : ""}` });
    pre.push({ account_id: survivorId, field: "parent_id", equals: surv.parent_id });
  }
  dups.forEach((d, i) => {
    ops.push({ id: `dup${i + 1}`, op: "update_account", account_id: d.account_id, fields: { duplicate_of_account: survivorId, status: "Inactive" }, editable: [],
      describe: `Mark “${d.name}” (${parentLabel(d)}) as a duplicate of the survivor and set it Inactive` });
    ops.push({ id: `note${i + 1}`, op: "append_note", account_id: d.account_id, text: `${tag} Duplicate of ${survivorId} (${l.name}); same facility at ${l.street}, ${l.city}.`,
      describe: `Note why on “${d.name}”` });
    pre.push({ account_id: d.account_id, field: "status", equals: d.status }, { account_id: d.account_id, field: "duplicate_of_account", equals: "" });
    if (opts.moveContacts) {
      for (const c of contactsOf(d.account_id).filter((c) => c.is_active)) {
        ops.push({ id: `contact-${c.contact_id}`, op: "move_contact", contact_id: c.contact_id, to_account_id: survivorId,
          describe: `Move contact ${c.name} (${c.title}) to the surviving record so they stay reachable` });
      }
    }
  });
  const tags = ["duplicate", ...(opts.reparent ? ["reparent"] : []), ...(opts.rename ? ["rename"] : [])];
  return mk({
    kind: "duplicate", tags, subject_key: `site:${slug}`, title: l.name,
    summary: `${dups.length + 1} CRM accounts for one building; keep one, retire ${dups.length}`,
    reasoning: [
      `${dups.length + 1} CRM accounts share ${l.name}'s street address and zip (${l.street}, ${l.zip}). One building, so one account should survive.`,
      `Survivor: ${surv.name} (${surv.account_id}). ${opts.why}`,
      `The others get duplicate_of_account = survivor and status Inactive. Their parent is left as is (marking a duplicate isn't a re-parent, so the SOP doesn't apply).`,
      ...(opts.reparent ? [sop(surv).explanation] : []),
    ],
    location: l, accounts: [role("survivor", surv, ["address"]), ...dups.map((d) => role("duplicate", d, ["address"]))],
    evidence: evidence(l, surv), sop: opts.reparent ? sop(surv) : null, confidence: "high", operations: ops, preconditions: pre,
  });
}

function renameCase(slug: string, id: string, cosmetic = false): Case {
  const l = loc(slug), a = acct(id);
  return mk({
    kind: "rename", tags: cosmetic ? ["rename", "cosmetic"] : ["rename"], subject_key: `site:${slug}`, title: l.name,
    summary: cosmetic ? `Name formatting differs from the website (“${a.name}”)` : `Outdated name: CRM still says “${a.name}”`,
    reasoning: [
      `Matches ${a.account_id} on street address and zip, and it's already under ${BELLHAVEN}.`,
      cosmetic
        ? `Only the name's formatting differs: “${a.name}” vs “${l.name}”. Low risk; aligns the CRM with the operator's published name.`
        : `The CRM name “${a.name}” predates the rebrand; the website calls it “${l.name}”.`,
    ],
    location: l, accounts: [role("target", a, ["address", "phone"])], evidence: evidence(l, a), confidence: cosmetic ? "medium" : "high",
    operations: [{ id: "op1", op: "update_account", account_id: id, fields: { name: l.name }, editable: ["name"], describe: `Rename to “${l.name}”` }],
    preconditions: [{ account_id: id, field: "name", equals: a.name }],
  });
}

function fieldFixCase(slug: string, id: string, field: "billing_zip", value: string, why: string): Case {
  const l = loc(slug), a = acct(id);
  return mk({
    kind: "field_fix", tags: ["field_fix"], subject_key: `site:${slug}`, title: l.name,
    summary: `Zip mismatch: CRM ${a[field]} vs website ${value}`,
    reasoning: [`Matches ${a.account_id} on street, city, phone and name.`, why],
    location: l, accounts: [role("target", a, ["address", "phone", "name"])], evidence: evidence(l, a), confidence: "high",
    operations: [{ id: "op1", op: "update_account", account_id: id, fields: { [field]: value }, editable: [field], describe: `Set billing zip to ${value}` }],
    preconditions: [{ account_id: id, field, equals: a[field] as string }],
  });
}

function createCase(slug: string, lookalikeId?: string, lookalikeWhy?: string): Case {
  const l = loc(slug);
  const look = lookalikeId ? acct(lookalikeId) : null;
  return mk({
    kind: "create", tags: ["create"], subject_key: `site:${slug}`, title: l.name,
    summary: `On Bellhaven's website but no CRM account at ${l.street}, ${l.city}`,
    reasoning: [
      `No CRM account matches ${l.street}, ${l.city} ${l.state} ${l.zip} by address, and nothing in that zip/city matches on phone or administrator.`,
      ...(look ? [`Look-alike ruled out: “${look.name}” (${parentLabel(look)}) ${lookalikeWhy}`] : []),
      `Create it under ${BELLHAVEN} with the website's details.`,
    ],
    location: l, accounts: look ? [role("lookalike", look, ["name"])] : [], evidence: [
      { field: "name", label: "Name", website: l.name, crm: null, match: "missing" },
      { field: "street", label: "Street", website: l.street, crm: null, match: "missing" },
      { field: "city", label: "City / State / Zip", website: `${l.city}, ${l.state} ${l.zip}`, crm: null, match: "missing" },
      { field: "care_type", label: "Care type", website: l.care_offerings.join(", "), crm: null, match: "missing" },
    ],
    confidence: look ? "medium" : "high",
    operations: [{ id: "op1", op: "create_account", ref: "new", editable: ADDRESS_FIELDS,
      fields: { ...siteFields(l), note: `${tag} Created from Bellhaven's website listing (${l.url}).` },
      describe: `Create “${l.name}” under ${BELLHAVEN}` }],
    preconditions: [],
  });
}

function unlistedCase(id: string): Case {
  const a = acct(id);
  return mk({
    kind: "unlisted", tags: ["unlisted"], subject_key: `account:${id}`, title: a.name,
    summary: "Under Bellhaven in the CRM, but no longer on Bellhaven's website",
    reasoning: [
      `${a.name} (${a.billing_city}, ${a.billing_state}) is parented to Bellhaven but isn't among the 35 communities on the website.`,
      `No other CRM account sits at ${a.billing_street}, so there's no evidence of who owns it now.`,
      `Flag it Needs Review with a note rather than guessing a new parent; the parent is left unchanged.`,
    ],
    location: null, accounts: [role("target", a)],
    evidence: [
      { field: "listed", label: "On Bellhaven's website", website: "Not listed", crm: "Under Bellhaven", match: "different", account_id: id },
      { field: "status", label: "Status", website: "—", crm: a.status, match: "same", account_id: id },
      { field: "street", label: "Street", website: null, crm: a.billing_street, match: "missing", account_id: id },
    ],
    confidence: "medium",
    operations: [
      { id: "op1", op: "update_account", account_id: id, fields: { status: "Needs Review" }, editable: [], describe: "Set status to Needs Review" },
      { id: "op2", op: "append_note", account_id: id, text: `${tag} No longer listed on Bellhaven's website; new owner unknown. Verify ownership before outreach.`, describe: "Add a note explaining why" },
    ],
    preconditions: [{ account_id: id, field: "status", equals: a.status }, { account_id: id, field: "parent_id", equals: a.parent_id }],
  });
}

// ---------------------------------------------- the queue ----------------------------------------------

export function buildMockCases(): Case[] {
  nextId = 1;
  const cases = [
    chowCase("bellhaven-of-tiffin", "001U6RW32TY0WSXZZB"),
    chowCase("bellhaven-of-marietta", "001A34WFSUYHCRBLFT"),
    soldCase("001SXSF4ELF0Z2LGDM", "0017JP8Z1UQ763BVK3"),
    duplicateCase("bellhaven-of-kettering", "0016KTS1UAWBRXS09J", ["001WR41PYNWXCAE2X4", "001B7XZAA3AFALS9GP"], {
      reparent: true, rename: true,
      why: "None of the three is under Bellhaven or has billing history, contacts or the website's phone; this one has the exact street spelling and the lowest id.",
    }),
    duplicateCase("bellhaven-gardens-of-monroe", "001U1750VLVJAGG1S5", ["0011AB44D05WLA9HTX", "00159PL81N38KM4FHM"], {
      why: "Already under Bellhaven with the website's name, and it holds the only contact.",
    }),
    duplicateCase("bellhaven-of-owosso", "001EGU7BMJ942ZTRE6", ["001QU150PM4Z15UA71"], {
      moveContacts: true, why: "Its phone matches the website and its Administrator contact (Gloria Lambert) is the website's administrator.",
    }),
    duplicateCase("bellhaven-of-port-clinton", "001UELXDAKFRKB8932", ["001JD2MWRA74LTSN24"], {
      why: "Already under Bellhaven with the website's name; its Administrator contact (Brenda Whitfield) matches the website.",
    }),
    duplicateCase("bellhaven-shores-of-erie", "001CVBBCSDM7YHN220", ["001BLYF02K97SZLZHH"], {
      why: "Already under Bellhaven with the website's name; its Administrator contact (Angela Quinn) matches the website.",
    }),
    reparentCase("bellhaven-of-zanesville", "001H1JMVZWP46D5VUF", { rename: true }),
    reparentCase("bellhaven-crossings-of-lima", "001LGFPBJY4N9MB6KL"),
    reparentCase("bellhaven-meadows-of-findlay", "001UKEFGADQ8YCZ4YM"),
    renameCase("bellhaven-of-chagrin-falls", "001RJU1X4NBWC1Q0G7"),
    renameCase("bellhaven-willow-creek", "0017MN2JYAJBDS8WQZ"),
    renameCase("bellhaven-of-chesterton", "0013NUZQHQUEZ8DXEG"),
    fieldFixCase("bellhaven-of-portsmouth", "001CF3LDWVRGL09P4F", "billing_zip", "45662",
      "The CRM zip 45626 looks like a transposition of the website's 45662 (Portsmouth, OH)."),
    renameCase("the-arbors-at-bellhaven-dayton", "0010KJFP601YNTZVDA", true),
    renameCase("bellhaven-healthcare-centre-of-ashland", "001RJ0D7Z5MAZN5HX5", true),
    renameCase("bellhaven-rehabilitation-nursing-of-grove-city", "001TZCSTBZFM6K5BGN", true),
    renameCase("bellhaven-at-sycamore-ridge", "00191H7JR16471SZ34", true),
    createCase("amberly-manor", "0015D74ZLRY810RGY5", "shares the name but is in Colorado Springs, CO: a different facility."),
    createCase("bellhaven-at-union-square", "001GNU41AVXZRLLJ9P", "is in the same zip, but at 240 Market St with a different phone and administrator: a different facility."),
    createCase("bellhaven-of-batavia"),
    createCase("bellhaven-of-carlisle"),
    unlistedCase("00116ETS45BL7DTQP7"),
    unlistedCase("0016PVXH4B25HWR7QE"),
  ];
  return cases;
}

const IN_SYNC: [string, string][] = [
  ["bellhaven-of-maplewood", "001L3LGR6W69J8DYYV"], ["bellhaven-of-new-carlisle", "001AQGPZ5G5VRES536"],
  ["bellhaven-of-wooster", "001W5G121A7SMRP58M"], ["bellhaven-terrace-of-akron", "0019Y4J61ZBG4R00CD"],
  ["bellhaven-of-saline", "001MVVAPY6U5TVYRC4"], ["bellhaven-of-goshen", "001JQER1RMYKNRLNME"],
  ["bellhaven-of-meadville", "001KC1NG7EZDEKKA3T"], ["bellhaven-of-defiance", "001R4PXTUD9R6FNN8V"],
  ["bellhaven-woods-of-toledo", "0014DHACE6WQU3RMM5"], ["bellhaven-of-marion", "0015L38R1Z5947ZZP7"],
  ["bellhaven-of-kalamazoo", "001NSHWKQD0YJLPQ20"], ["bellhaven-court-of-altoona", "0011D2P3CWSHMF81C8"],
  ["bellhaven-of-ashtabula", "001NXP9X46CWEPSLSV"],
];

/** The pipeline's own audit entry for each case ("proposed by run #1"), as the real pipeline writes it. */
export function buildMockEvents(cases: Case[]): Omit<CaseEvent, "id">[] {
  return cases.map((c) => ({
    case_id: c.id, at: c.created_at ?? `${TODAY}T19:40:00.000Z`, event: "proposed", actor: "pipeline run #1", via: "pipeline",
    detail: { run_id: 1, fingerprint: c.fingerprint },
  }));
}

export function buildMockRuns(cases: Case[]): Run[] {
  const match_results: MatchResult[] = IN_SYNC.map(([slug, id]) => {
    const l = loc(slug), a = acct(id);
    const signals = ["address", ...(digits(l.phone) === digits(a.phone) ? ["phone"] : []), ...(normName(l.name) === normName(a.name) ? ["name"] : [])];
    return {
      subject_key: `site:${slug}`, name: l.name, classification: "in_sync", account_id: id, account_name: a.name,
      confidence: slug === "bellhaven-of-ashtabula" ? "medium" : "high",
      signals: slug === "bellhaven-of-ashtabula" ? ["zip", "phone", "name"] : signals,
    };
  });
  for (const c of cases) {
    const a = c.accounts.find((x) => x.role === "target" || x.role === "survivor" || x.role === "old_record");
    match_results.push({ subject_key: c.subject_key, name: c.title, classification: "case", account_id: a?.account.account_id ?? null,
      account_name: a?.account.name ?? null, confidence: c.confidence, signals: a?.match_signals ?? [] });
  }
  return [{
    id: 1, started_at: `${TODAY}T19:38:12.000Z`, finished_at: `${TODAY}T19:39:58.000Z`, trigger: "manual", status: "succeeded",
    location_count: 35, account_count: 121, error: null, match_results,
    summary: {
      new: cases.length, refreshed: 0, skipped_decided: 0, superseded: 0, in_sync: IN_SYNC.length,
      scrape: { claimed_count: 35, directory_count: 34, found_count: 35, pages_visited: 3, homepage_only: ["bellhaven-meadows-of-findlay"] },
    },
  }];
}
