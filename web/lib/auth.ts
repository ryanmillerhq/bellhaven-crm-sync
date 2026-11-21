import "server-only";
/**
 * Who may write, and who is writing.
 *
 * Passcode gate: viewing is public; approve/reject/reopen need either a signed session cookie (after entering
 * REVIEW_PASSCODE in the UI) or the `x-review-passcode` header (MCP / curl). With no REVIEW_PASSCODE set
 * (local development) writes are allowed without it.
 *
 * Reviewer identity: every CRM write goes through ONE shared API token, so the CRM can't tell reviewers apart.
 * Our audit trail does: the UI stores the reviewer's name (and optional email) in a signed cookie, and API/MCP
 * callers must send an `x-reviewer` header. That identity is stamped on the case, every audit event, every
 * operation result, and every note the executor writes into the CRM.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { Actor } from "./types";

const SESSION_COOKIE = "bh_review";
const REVIEWER_COOKIE = "bh_reviewer";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7;
const REVIEWER_MAX_AGE_S = 60 * 60 * 24 * 90;

export interface Reviewer { name: string; email: string | null }

export const passcodeRequired = () => !!process.env.REVIEW_PASSCODE;

function secret() {
  // Prefer a dedicated secret; fall back to one derived from the passcode so sessions die when it rotates.
  return new TextEncoder().encode(process.env.SESSION_SECRET || `bellhaven-review:${process.env.REVIEW_PASSCODE ?? "local"}`);
}

const cookieOpts = (maxAge: number) => ({
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge,
});

function samePasscode(given: string | null | undefined) {
  const expected = process.env.REVIEW_PASSCODE ?? "";
  if (!expected || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function verify(token: string | undefined, audience: string) {
  if (!token) return null;
  try {
    return (await jwtVerify(token, secret(), { audience })).payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- passcode gate

function cookieFromHeader(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * True when the current request may perform writes. Route handlers pass their Request (passcode header or the
 * session cookie on that request); server actions call it without one and the cookie store is used.
 */
export async function canWrite(req?: Request): Promise<boolean> {
  if (!passcodeRequired()) return true;
  if (req) {
    if (samePasscode(req.headers.get("x-review-passcode"))) return true;
    return !!(await verify(cookieFromHeader(req, SESSION_COOKIE), "bellhaven-review"));
  }
  return !!(await verify((await cookies()).get(SESSION_COOKIE)?.value, "bellhaven-review"));
}

export async function startSession(passcode: string): Promise<boolean> {
  if (!passcodeRequired()) return true;
  if (!samePasscode(passcode)) return false;
  const token = await new SignJWT({ role: "reviewer" }).setProtectedHeader({ alg: "HS256" })
    .setAudience("bellhaven-review").setIssuedAt().setExpirationTime(`${SESSION_MAX_AGE_S}s`).sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, cookieOpts(SESSION_MAX_AGE_S));
  return true;
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

// ---------------------------------------------------------------- reviewer identity

const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\r\n\t<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function normalizeReviewer(name: unknown, email: unknown): Reviewer | null {
  const n = clean(name, 80);
  const e = clean(email, 120);
  if (n.length < 2) return null;
  return { name: n, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null };
}

/** "Ryan Miller (ryan@example.com)": the label stamped into decided_by, audit events and CRM notes. */
export const reviewerLabel = (r: Reviewer) => (r.email ? `${r.name} (${r.email})` : r.name);

export async function getReviewer(): Promise<Reviewer | null> {
  const p = await verify((await cookies()).get(REVIEWER_COOKIE)?.value, "bellhaven-reviewer");
  return p ? normalizeReviewer(p.name, p.email) : null;
}

export async function setReviewer(r: Reviewer) {
  const token = await new SignJWT({ name: r.name, email: r.email }).setProtectedHeader({ alg: "HS256" })
    .setAudience("bellhaven-reviewer").setIssuedAt().setExpirationTime(`${REVIEWER_MAX_AGE_S}s`).sign(secret());
  (await cookies()).set(REVIEWER_COOKIE, token, cookieOpts(REVIEWER_MAX_AGE_S));
}

/**
 * Actor for API/MCP writes, from the required `x-reviewer` header (e.g. "Ryan Miller (via Claude MCP)").
 * via = "ui" only for the review app's own keepalive flush (x-review-via: ui); everything else is "mcp".
 */
export function actorFromRequest(req: Request): Actor | null {
  const name = clean(req.headers.get("x-reviewer"), 120);
  if (name.length < 2) return null;
  return { name, via: req.headers.get("x-review-via") === "ui" ? "ui" : "mcp" };
}
