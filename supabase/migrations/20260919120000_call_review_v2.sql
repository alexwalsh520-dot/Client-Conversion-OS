-- Call Review Autopilot v2 (2026-09-19).
-- Paste into the Supabase SQL editor (no programmatic DDL path in this project).
--
-- 1. mm_call_reviews.fields: Jeremy's structured JSON footer per call
--    (sub-scores, objections with verbatim quotes, prospect language, setter
--    handoff, systemic flags, review flag) merged with what the system knows
--    (tracker outcome/cash/setter, closer 14-day trend, DM availability).
--    The digests and the weekly report read from it. The code tolerates the
--    column being absent (reviews still save, Slack still posts) but the
--    marketing brief and weekly report are thin without it.
alter table mm_call_reviews add column if not exists fields jsonb;

-- 2. mm_reports: nightly marketing briefs and Monday weekly reports.
--    (mm_daily_digests keeps the sales brief; its digest_date is unique so a
--    second report per day needs its own home.)
create table if not exists mm_reports (
  id bigserial primary key,
  kind text not null,          -- 'marketing' | 'weekly'
  period_key text not null,    -- YYYY-MM-DD (day) or week-start Monday
  report_md text not null,
  fields jsonb,
  model text,
  created_at timestamptz not null default now(),
  unique (kind, period_key)
);
