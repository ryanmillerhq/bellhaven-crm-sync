import "server-only";
import type { CrmAccount, CrmContact } from "./types";

/** Everything the app needs from the CRM. The executor depends only on this interface (tests inject a fake). */
export interface CrmClient {
  getAccount(id: string): Promise<CrmAccount>;
  searchAccounts(q: string): Promise<CrmAccount[]>;
  /** List endpoint filters (the API supports street / zip / q); used to make creates idempotent. */
  findAccounts(filter: { street?: string; zip?: string; q?: string }): Promise<CrmAccount[]>;
  listContacts(accountId: string): Promise<CrmContact[]>;
  createAccount(fields: Record<string, unknown>): Promise<{ id: string; response: unknown }>;
  updateAccount(id: string, fields: Record<string, unknown>): Promise<unknown>;
  updateContact(id: string, fields: Record<string, unknown>): Promise<unknown>;
}

export class CrmError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
  }
}

/** Unwrap `{data: obj}` or return the object itself (POST/PATCH response shapes are not documented). */
function unwrap(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && "data" in body && body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
    return body.data as Record<string, unknown>;
  }
  return (body ?? {}) as Record<string, unknown>;
}

/** Real HTTP client. Server-only: the token never leaves the server. */
export class HttpCrmClient implements CrmClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    // Fail on use, not construction: pages that only read the review store still work without a CRM token.
    if (!this.token) throw new CrmError("CRM_API_TOKEN is not set");
    const res = await fetch(this.baseUrl.replace(/\/$/, "") + path, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok) throw new CrmError(`CRM ${method} ${path} → ${res.status}`, res.status, parsed);
    return parsed;
  }

  async getAccount(id: string): Promise<CrmAccount> {
    // Verified: GET /accounts/{id} returns the account object directly.
    return unwrap(await this.call("GET", `/accounts/${encodeURIComponent(id)}`)) as CrmAccount;
  }

  async searchAccounts(q: string): Promise<CrmAccount[]> {
    const body = (await this.call("GET", `/accounts?q=${encodeURIComponent(q)}&page_size=50`)) as { data?: CrmAccount[] };
    return body?.data ?? [];
  }

  async findAccounts(filter: { street?: string; zip?: string; q?: string }): Promise<CrmAccount[]> {
    const params = new URLSearchParams({ page_size: "100" });
    for (const [k, v] of Object.entries(filter)) if (v) params.set(k, v);
    const body = (await this.call("GET", `/accounts?${params}`)) as { data?: CrmAccount[] };
    return body?.data ?? [];
  }

  async listContacts(accountId: string): Promise<CrmContact[]> {
    const body = (await this.call("GET", `/contacts?account_id=${encodeURIComponent(accountId)}&page_size=100`)) as { data?: CrmContact[] };
    return body?.data ?? [];
  }

  async createAccount(fields: Record<string, unknown>) {
    const response = await this.call("POST", "/accounts", fields);
    const obj = unwrap(response);
    const id = (obj.account_id ?? obj.id) as string | undefined;
    if (!id) throw new CrmError("CRM created the account but returned no account_id", 201, response);
    return { id, response };
  }

  updateAccount(id: string, fields: Record<string, unknown>) {
    return this.call("PATCH", `/accounts/${encodeURIComponent(id)}`, fields);
  }

  updateContact(id: string, fields: Record<string, unknown>) {
    return this.call("PATCH", `/contacts/${encodeURIComponent(id)}`, fields);
  }
}
