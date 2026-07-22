-- Daily FX reference rates (ECB via Frankfurter, fallback open-er-api).
-- rate = units of quote per 1 unit of base: base=AUD quote=USD rate=0.70 -> 1 AUD = 0.70 USD.
create table if not exists public.fx_rates (
  rate_date date not null,
  base text not null,
  quote text not null default 'USD',
  rate numeric not null check (rate > 0),
  source text not null,
  carried boolean not null default false,
  fetched_at timestamptz not null default now(),
  primary key (rate_date, base, quote)
);
create index if not exists fx_rates_base_quote_date on public.fx_rates (base, quote, rate_date);

alter table public.fx_rates enable row level security;
drop policy if exists fx_rates_service_all on public.fx_rates;
create policy fx_rates_service_all on public.fx_rates for all to service_role using (true) with check (true);
drop policy if exists fx_rates_read on public.fx_rates;
create policy fx_rates_read on public.fx_rates for select to anon, authenticated using (true);
