"use server";
/** Server actions used by the review UI. Same service layer (and executor) as the /api routes the MCP calls. */
import { revalidatePath } from "next/cache";
import {
  canWrite, endSession, getReviewer, normalizeReviewer, passcodeRequired, reviewerLabel, setReviewer, startSession,
} from "@/lib/auth";
import { approve, reject, reopen } from "@/lib/cases";
import { CaseConflict, CaseNotFound, CaseRefreshed, type Outcome } from "@/lib/executor";
import type { Actor, Case, Edits } from "@/lib/types";

export type ActionResult =
  | { ok: true; outcome?: Outcome; case: Case }
  | { ok: false; error: string; locked?: boolean; needsReviewer?: boolean; refreshed?: boolean };

async function guarded(fn: (actor: Actor) => Promise<{ case: Case; outcome?: Outcome }>): Promise<ActionResult> {
  if (!(await canWrite())) return { ok: false, locked: true, error: "Enter the review passcode to make decisions." };
  const reviewer = await getReviewer();
  if (!reviewer) return { ok: false, needsReviewer: true, error: "Tell us who's reviewing first; every decision is signed." };
  try {
    return { ok: true, ...(await fn({ name: reviewerLabel(reviewer), via: "ui" })) };
  } catch (e) {
    if (e instanceof CaseRefreshed) return { ok: false, refreshed: true, error: e.message };
    if (e instanceof CaseConflict || e instanceof CaseNotFound) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  } finally {
    revalidatePath("/");
  }
}

/** `expectedUpdatedAt` = the version the reviewer looked at; a case refreshed since then is not executed. */
export async function approveAction(id: number, edits: Edits, note: string | null, expectedUpdatedAt: string | null) {
  return guarded((actor) => approve(id, { edits, note, actor, expectedUpdatedAt }));
}

export async function rejectAction(id: number, reason: string | null) {
  return guarded(async (actor) => ({ case: await reject(id, { reason, actor }) }));
}

export async function reopenAction(id: number) {
  return guarded(async (actor) => ({ case: await reopen(id, { actor }) }));
}

/** "Who's reviewing?" (and, when hosted, the passcode) in one step. */
export async function identifyAction(input: { name: string; email?: string; passcode?: string }): Promise<{ ok: boolean; error?: string }> {
  const reviewer = normalizeReviewer(input.name, input.email);
  if (!reviewer) return { ok: false, error: "Please enter your name (at least 2 characters)." };
  if (passcodeRequired() && !(await canWrite())) {
    if (!input.passcode || !(await startSession(input.passcode))) return { ok: false, error: "That passcode didn't match." };
  }
  await setReviewer(reviewer);
  revalidatePath("/");
  return { ok: true };
}

export async function lockAction() {
  await endSession();
  revalidatePath("/");
}
