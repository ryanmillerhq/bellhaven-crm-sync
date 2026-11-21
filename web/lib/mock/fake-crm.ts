import type { CrmClient } from "../crm";
import type { CrmAccount, CrmContact } from "../types";

export interface FakeCall { method: "GET" | "POST" | "PATCH"; path: string; body?: unknown }

/**
 * In-memory CRM with the same behaviour the executor relies on: GET returns the bare account, POST assigns an id,
 * PATCH merges fields. Used by mock mode and by the executor tests. Never touches the network.
 */
export class FakeCrm implements CrmClient {
  readonly accounts = new Map<string, CrmAccount>();
  readonly contacts = new Map<string, CrmContact>();
  readonly calls: FakeCall[] = [];
  /** Test hook: return an Error to make a given call fail. */
  failWhen: ((call: FakeCall) => Error | null) | null = null;
  private seq = 0;

  constructor(accounts: CrmAccount[], contacts: CrmContact[] = []) {
    for (const a of accounts) this.accounts.set(a.account_id, structuredClone(a));
    for (const c of contacts) this.contacts.set(c.contact_id, structuredClone(c));
  }

  private record(call: FakeCall) {
    this.calls.push(call);
    const err = this.failWhen?.(call);
    if (err) throw err;
  }

  get writes() {
    return this.calls.filter((c) => c.method !== "GET");
  }

  async getAccount(id: string) {
    this.record({ method: "GET", path: `/accounts/${id}` });
    const a = this.accounts.get(id);
    if (!a) throw new Error(`CRM GET /accounts/${id} → 404`);
    return structuredClone(a);
  }

  async searchAccounts(q: string) {
    this.record({ method: "GET", path: `/accounts?q=${q}` });
    const needle = q.trim().toLowerCase();
    return [...this.accounts.values()]
      .filter((a) => !needle || [a.name, a.billing_city, a.billing_street, a.account_id].some((v) => String(v).toLowerCase().includes(needle)))
      .slice(0, 50)
      .map((a) => structuredClone(a));
  }

  async listContacts(accountId: string) {
    this.record({ method: "GET", path: `/contacts?account_id=${accountId}` });
    return [...this.contacts.values()].filter((c) => c.account_id === accountId).map((c) => structuredClone(c));
  }

  async createAccount(fields: Record<string, unknown>) {
    this.record({ method: "POST", path: "/accounts", body: fields });
    const id = `001MOCK${String(++this.seq).padStart(11, "0")}`;
    const parent = fields.parent_id ? this.accounts.get(String(fields.parent_id)) : undefined;
    const account = {
      account_id: id, name: "", parent_id: "", parent_name: parent?.name ?? "", billing_street: "", billing_city: "",
      billing_state: "", billing_zip: "", care_type: "", phone: "", status: "Active", lifetime_revenue: 0, outstanding_ar: 0,
      duplicate_of_account: "", chow_current_account: "", note: "", created_by_candidate: true, ...fields,
      updated_at: new Date().toISOString(),
    } as CrmAccount;
    this.accounts.set(id, account);
    return { id, response: structuredClone(account) };
  }

  async updateAccount(id: string, fields: Record<string, unknown>) {
    this.record({ method: "PATCH", path: `/accounts/${id}`, body: fields });
    const a = this.accounts.get(id);
    if (!a) throw new Error(`CRM PATCH /accounts/${id} → 404`);
    Object.assign(a, fields, { updated_at: new Date().toISOString() });
    if ("parent_id" in fields) a.parent_name = this.accounts.get(String(fields.parent_id))?.name ?? "";
    return structuredClone(a);
  }

  async updateContact(id: string, fields: Record<string, unknown>) {
    this.record({ method: "PATCH", path: `/contacts/${id}`, body: fields });
    const c = this.contacts.get(id);
    if (!c) throw new Error(`CRM PATCH /contacts/${id} → 404`);
    Object.assign(c, fields);
    return structuredClone(c);
  }
}
