-- "Sharpest lines" tab on /icp.
--
-- A hand-picked selection from the full corpus, grouped under the frames the
-- quotes were chosen to illustrate. The picking is editorial; the words are
-- verbatim. Source of truth is data/icp-sharpest-lines.md — edit that file and
-- re-run scripts/sync-icp-highlights.mjs.
--
-- kind = 'quote' (a person's words) or 'note' (an editorial aside kept inline).
-- Same lock-down as the rest of the ICP tables: service-role only.

create table if not exists public.icp_highlights (
  id           bigserial primary key,
  section      text not null,
  section_pos  integer not null default 0,
  position     integer not null default 0,
  kind         text not null default 'quote',
  quote        text not null,
  person_name  text,
  said_on      date
);

create index if not exists icp_highlights_order_idx on public.icp_highlights (section_pos, position);

alter table public.icp_highlights enable row level security;
revoke all on public.icp_highlights from anon, authenticated;
