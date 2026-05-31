-- AI usage tracking for the "$50/month AI budget" meter.
-- One row per Anthropic messages.create / stream call. cost_usd is computed at
-- log time from the exact token counts the API returned (see src/lib/ai-usage.ts),
-- so totals are real spend, never estimates.

create table if not exists ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  feature            text,
  model              text,
  input_tokens       int  not null default 0,
  output_tokens      int  not null default 0,
  cache_write_tokens int  not null default 0,
  cache_read_tokens  int  not null default 0,
  cost_usd           numeric(10,6) not null default 0
);

-- The meter queries month-to-date by created_at, so index it.
create index if not exists ai_usage_created_at_idx on ai_usage (created_at);
