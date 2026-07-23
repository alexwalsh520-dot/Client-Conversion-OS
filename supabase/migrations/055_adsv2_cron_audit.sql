-- ─────────────────────────────────────────────────────────────────────────
-- Ads v2 P0.4 — architecture law, encoded. No pg_cron job may make HTTP calls
-- or run heavy/unlisted statements. This function lets the nightly self-check
-- read cron.job (which PostgREST cannot reach on its own) and flag any job that
-- calls out over HTTP/pg_net or is not on the tiny allowlist of pure-SQL jobs.
--
-- The 7/23 incident was driven by a pg_cron job that HTTP-called a Vercel
-- endpoint every 60 seconds (a doom loop). That class is now impossible to add
-- silently: it shows up here and writes an alert.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.adsv2_audit_cron_jobs()
returns table (jobid bigint, jobname text, schedule text, command text, violation text)
language sql
security definer
set search_path = public, cron
as $$
  select
    j.jobid,
    j.jobname,
    j.schedule,
    j.command,
    case
      when j.command ~* 'net\.http|http_post|http_get|http\(|pg_net' then 'http_call'
      when j.jobname is null or j.jobname not in ('daily-business-snapshot') then 'unlisted_job'
      else 'ok'
    end as violation
  from cron.job j
  where j.command ~* 'net\.http|http_post|http_get|http\(|pg_net'
     or j.jobname is null
     or j.jobname not in ('daily-business-snapshot');
$$;

grant execute on function public.adsv2_audit_cron_jobs() to service_role;
