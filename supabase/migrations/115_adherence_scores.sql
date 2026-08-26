-- ─────────────────────────────────────────────────────────────────────────
-- 115 — REP ADHERENCE SCORES: one graded verdict per sales call per rubric,
-- so "did the closer run the pre-call confirmation process" stops being a
-- vibe and becomes a number on the Sales Dashboard.
--
-- Source: /api/cron/adherence-grade reads sales bookings from
-- warehouse.metrics_lead_events, pulls the SendBlue group-chat thread for
-- the appointment's contact phone, runs a deterministic timing pre-pass
-- (ready-ping window, follow-up window) plus ONE Claude call for the
-- semantic checks, and inserts exactly one row per (kind, appointment).
--
-- kind is the rubric:
--   'pre_call' — the How To Confirm Calls SOP (confirm / agenda question /
--                acknowledge / time-excitement / T-5 ready ping / follow-up
--                when unconfirmed). Live now.
--   'closing'  — the closing-script rubric. RESERVED: the script arrives
--                later; the dashboard already renders its placeholder slot.
--
-- score = passed_checks ÷ applicable_checks (0..1). score stays NULL when
-- no SendBlue thread was found (thread_found = false) so ungradeable calls
-- never drag a closer's average; the row still exists so the cron does not
-- re-grade the same appointment every run. checks holds the full per-check
-- verdict array: [{id, label, applicable, passed, evidence}].
--
-- Same posture as 113/114: warehouse table, RLS on with NO anon policies,
-- service-role writes only, boundary read role gets select, public
-- security_invoker compatibility view. Idempotent; pasted by hand — all app
-- code tolerates this table not existing (empty results + migration_pending).
-- ─────────────────────────────────────────────────────────────────────────

create schema if not exists warehouse;

create table if not exists warehouse.metrics_adherence_scores (
  id uuid primary key default gen_random_uuid(),

  -- Short canonical creator key ('tyson', 'jake').
  client_key text not null,
  -- GHL appointment id the graded call belongs to (the natural join back to
  -- warehouse.ghl_appointments and metrics_lead_events booking metadata).
  appointment_key text not null,
  -- Engine lead key ('mc:…' / 'ig:…'), when the booking event carried one.
  lead_key text,
  -- Short rep key from src/lib/metrics-engine/team.ts, when a rep owns the
  -- appointment.
  rep_key text,

  -- Which rubric this row grades.
  kind text not null check (kind in ('pre_call','closing')),

  -- passed ÷ applicable, 0..1. NULL when the call was ungradeable (no
  -- SendBlue thread) so averages only ever include real grades.
  score numeric check (score is null or (score >= 0 and score <= 1)),
  applicable_checks integer not null default 0,
  passed_checks integer not null default 0,

  -- The full verdict: array of {id, label, applicable, passed, evidence}.
  checks jsonb not null default '[]'::jsonb,

  -- False when no SendBlue thread existed for the contact phone (score NULL).
  thread_found boolean not null default false,

  graded_at timestamptz not null default now(),
  -- The model that produced the semantic verdicts ('claude-opus-5'), or a
  -- marker like 'deterministic-only' when no Claude call was needed/possible.
  model text,
  notes text,

  unique (kind, appointment_key)
);

comment on table warehouse.metrics_adherence_scores is
  'Rep adherence grades: one row per (kind, appointment). kind=pre_call grades the pre-call confirmation SOP from the SendBlue thread; kind=closing is reserved for the closing script. Written only by /api/cron/adherence-grade (service role). score NULL = ungradeable (no thread), never counted in averages.';

create index if not exists idx_metrics_adherence_scores_client
  on warehouse.metrics_adherence_scores (client_key, graded_at desc);
create index if not exists idx_metrics_adherence_scores_rep
  on warehouse.metrics_adherence_scores (rep_key, kind);
create index if not exists idx_metrics_adherence_scores_appointment
  on warehouse.metrics_adherence_scores (appointment_key);

alter table warehouse.metrics_adherence_scores enable row level security;

grant select, insert, update, delete on warehouse.metrics_adherence_scores to service_role;

create or replace view public.metrics_adherence_scores
  with (security_invoker = true) as select * from warehouse.metrics_adherence_scores;
grant select on public.metrics_adherence_scores to service_role;

comment on view public.metrics_adherence_scores is
  'COMPATIBILITY VIEW over warehouse.metrics_adherence_scores (migration 115). Readers only, security_invoker. Writers must address warehouse.metrics_adherence_scores.';

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'ai_marketing_readonly') then
    grant select on warehouse.metrics_adherence_scores to ai_marketing_readonly;
    revoke insert, update, delete, truncate, references, trigger
      on warehouse.metrics_adherence_scores from ai_marketing_readonly;
  end if;
end $$;
