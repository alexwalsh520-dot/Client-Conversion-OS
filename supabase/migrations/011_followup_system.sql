-- 011_followup_system.sql
-- AI Follow-Up System — tag-triggered, split-tested Instagram DM scheduler.
-- Reuses existing dm_conversation_messages table for message logging.

-- ============================================================
-- Cadence: default gaps for each slot. Editable per client later.
-- Slot 1 = setter's manual first message (not scheduled by us).
-- Slots 2–5 are AI sends. "close" fires 24h after slot 5 with no reply.
-- ============================================================
create table if not exists followup_cadence (
  id              serial primary key,
  client          text not null,
  slot            text not null,           -- '2' | '3' | '4' | '5' | 'close'
  offset_minutes  int  not null,           -- minutes from setter's first message
  unique (client, slot)
);

-- Seed Tyson Sonnek defaults
insert into followup_cadence (client, slot, offset_minutes) values
  ('tyson_sonnek', '2',     15),                   -- +15m
  ('tyson_sonnek', '3',     15 + 24*60),           -- +24h 15m
  ('tyson_sonnek', '4',     15 + 72*60),           -- +72h 15m
  ('tyson_sonnek', '5',     15 + 120*60),          -- +120h 15m
  ('tyson_sonnek', 'close', 15 + 144*60)           -- +144h 15m
on conflict (client, slot) do nothing;

-- ============================================================
-- Variants: the message pool, per slot, per client
-- ============================================================
create table if not exists followup_variants (
  id           bigserial primary key,
  client       text not null,                     -- tyson_sonnek | keith_holland | ...
  slot         int  not null,                     -- 2 | 3 | 4 | 5
  type         text not null default 'text',      -- text | meme | voicenote
  body         text,
  media_url    text,
  status       text not null default 'active',    -- active | paused
  note         text,                              -- human note, e.g. "Amara-style bump"
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists followup_variants_lookup
  on followup_variants(client, slot, status);

-- ============================================================
-- Jobs: the scheduler's work queue
-- ============================================================
create table if not exists followup_jobs (
  id            bigserial primary key,
  client        text not null,
  subscriber_id text not null,                    -- Instagram user ID (same column as dm_conversation_messages.subscriber_id)
  type          text not null,                    -- 'send' | 'close'
  slot          int,                              -- null for close jobs
  scheduled_at  timestamptz not null,
  status        text not null default 'pending',  -- pending | running | sent | cancelled | failed
  attempts      int  not null default 0,
  last_error    text,
  metadata      jsonb not null default '{}'::jsonb, -- {lead_name, setter_name, phone, ghl_contact_id, ...}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Fast index for cron drain
create index if not exists followup_jobs_due
  on followup_jobs(scheduled_at, status) where status = 'pending';

-- Fast index for reply-cancel
create index if not exists followup_jobs_subscriber
  on followup_jobs(subscriber_id, status) where status = 'pending';

-- ============================================================
-- Sends: attribution — which variant went to which lead
-- ============================================================
create table if not exists followup_sends (
  id             bigserial primary key,
  client         text not null,
  subscriber_id  text not null,
  variant_id     bigint not null references followup_variants(id),
  slot           int  not null,
  job_id         bigint references followup_jobs(id),
  channel        text not null default 'instagram',  -- instagram | sms
  scheduled_at   timestamptz,
  sent_at        timestamptz not null default now(),
  ig_message_id  text,
  -- Reply tracking
  replied_at     timestamptz,
  reply_text     text,
  created_at     timestamptz not null default now()
);

create index if not exists followup_sends_subscriber on followup_sends(subscriber_id);
create index if not exists followup_sends_variant on followup_sends(variant_id);
create index if not exists followup_sends_attribution
  on followup_sends(subscriber_id, sent_at) where replied_at is null;

-- ============================================================
-- View: variant_stats — for epsilon-greedy picker
-- ============================================================
create or replace view followup_variant_stats as
select
  v.id                                           as variant_id,
  v.client,
  v.slot,
  v.status,
  count(s.id)                                    as sends,
  count(s.id) filter (where s.replied_at is not null) as replies,
  case when count(s.id) > 0
       then count(s.id) filter (where s.replied_at is not null)::float / count(s.id)
       else 0
  end                                            as reply_rate
from followup_variants v
left join followup_sends s on s.variant_id = v.id
group by v.id, v.client, v.slot, v.status;

-- ============================================================
-- Function: cancel all pending jobs for a subscriber (called on reply)
-- ============================================================
create or replace function followup_cancel_pending(p_subscriber_id text)
returns int as $$
declare
  cancelled int;
begin
  update followup_jobs
     set status = 'cancelled', updated_at = now()
   where subscriber_id = p_subscriber_id
     and status = 'pending';
  get diagnostics cancelled = row_count;
  return cancelled;
end;
$$ language plpgsql;

-- ============================================================
-- Function: attribute a reply to the most recent send (within 72h)
-- Called from the Instagram webhook after storing an inbound message.
-- ============================================================
create or replace function followup_attribute_reply(
  p_subscriber_id text,
  p_reply_text text,
  p_received_at timestamptz default now()
)
returns bigint as $$
declare
  target_send_id bigint;
begin
  select id into target_send_id
  from followup_sends
  where subscriber_id = p_subscriber_id
    and sent_at >= p_received_at - interval '72 hours'
    and replied_at is null
  order by sent_at desc
  limit 1;

  if target_send_id is not null then
    update followup_sends
      set replied_at = p_received_at,
          reply_text = p_reply_text
      where id = target_send_id;
  end if;

  return target_send_id;
end;
$$ language plpgsql;
