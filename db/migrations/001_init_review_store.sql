-- 001_init_review_store.sql
-- Review store for Bellhaven CRM Sync: pipeline runs, review cases (proposed CRM changes) and their audit trail.
-- This is the shared memory that makes daily re-runs safe: a case that was approved or rejected is never proposed
-- again (unique fingerprint), and every write the review app makes is traceable to a human decision.
-- Safe to re-run.

-- ---------------------------------------------------------------------------------------------------------------
-- runs: one row per pipeline execution (manual, daily schedule, or CI)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.runs (
  id               bigint generated always as identity primary key,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  trigger          text        not null default 'manual' check (trigger in ('manual', 'schedule', 'ci')),
  status           text        not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  location_count   integer,                                 -- communities scraped from the website
  account_count    integer,                                 -- CRM accounts read
  summary          jsonb       not null default '{}'::jsonb, -- counts: new / refreshed / skipped (decided) / superseded, scrape report
  scrape_snapshot  jsonb,                                   -- the locations exactly as scraped (evidence + day-over-day diffing)
  match_results    jsonb,                                   -- classification of every location and Bellhaven account, incl. in-sync
  error            text
);

-- ---------------------------------------------------------------------------------------------------------------
-- cases: one row per facility that needs a decision. Bundles every change for that facility.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.cases (
  id                bigint generated always as identity primary key,
  fingerprint       text        not null unique,             -- sha256(kind | subject | desired values): idempotency key
  kind              text        not null,                    -- primary kind: chow, reparent, duplicate, rename, field_fix, create, sold, unlisted, ...
  tags              text[]      not null default '{}',       -- every change in the bundle, e.g. {reparent, rename}
  subject_key       text        not null,                    -- 'site:<slug>' or 'account:<account_id>'
  title             text        not null,
  summary           text,
  reasoning         jsonb       not null default '[]'::jsonb, -- plain-English bullets shown to the reviewer
  location          jsonb,                                   -- scraped website record (evidence)
  accounts          jsonb       not null default '[]'::jsonb, -- CRM accounts involved, snapshotted, each with a role
  evidence          jsonb       not null default '[]'::jsonb, -- field-by-field website vs CRM comparison
  sop               jsonb,                                   -- CHOW check: revenue, AR, branch taken and why
  confidence        text        check (confidence in ('high', 'medium', 'low')),
  operations        jsonb       not null default '[]'::jsonb, -- ordered CRM API operations the approval will execute
  preconditions     jsonb       not null default '[]'::jsonb, -- CRM values assumed; re-checked before any write
  status            text        not null default 'pending'
                    check (status in ('pending', 'applying', 'applied', 'rejected', 'failed', 'stale', 'superseded')),
  first_seen_run    bigint      references public.runs (id),
  last_seen_run     bigint      references public.runs (id),
  decided_at        timestamptz,
  decided_by        text,
  decided_via       text        check (decided_via in ('ui', 'mcp')),
  decision_note     text,
  final_operations  jsonb,                                   -- what actually ran (after any reviewer edits)
  result            jsonb,                                   -- per-operation API responses, created ids
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists cases_status_idx  on public.cases (status);
create index if not exists cases_subject_idx on public.cases (subject_key);

-- ---------------------------------------------------------------------------------------------------------------
-- case_events: append-only audit trail (proposed, refreshed, approved, rejected, applied, failed, stale, ...)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.case_events (
  id       bigint generated always as identity primary key,
  case_id  bigint      not null references public.cases (id) on delete cascade,
  at       timestamptz not null default now(),
  event    text        not null,
  actor    text,
  via      text,
  detail   jsonb
);

create index if not exists case_events_case_idx on public.case_events (case_id, at);

-- keep cases.updated_at current
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cases_touch_updated_at on public.cases;
create trigger cases_touch_updated_at before update on public.cases
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- Lock the tables away from Supabase's public REST API (anon/authenticated keys). The pipeline and the review
-- app connect as the database owner over the pooler, which bypasses RLS, so no policies are needed.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.runs        enable row level security;
alter table public.cases       enable row level security;
alter table public.case_events enable row level security;
