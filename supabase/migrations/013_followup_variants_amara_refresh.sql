-- Refresh Tyson's follow-up variants to 3-per-slot.
-- Slots 2 and 4 = text (Amara's voice). Slots 3 and 5 = meme (seeded empty,
-- uploaded via the Sales Hub UI).

-- Safe because at time of this migration no real sends have been attributed
-- to any existing variants (content-range: */0 on followup_sends for this client).

delete from followup_variants where client = 'tyson_sonnek';

-- Slot 2 (+15m): 3 quick nudges in Amara's voice
insert into followup_variants (client, slot, type, body) values
  ('tyson_sonnek', 2, 'text', '^'),
  ('tyson_sonnek', 2, 'text', 'you still there g?'),
  ('tyson_sonnek', 2, 'text', 'all good?');

-- Slot 3 (+24h15m): MEME slot — Matthew uploads via Scripts tab

-- Slot 4 (+72h15m): 3 pattern interrupts
insert into followup_variants (client, slot, type, body) values
  ('tyson_sonnek', 4, 'text', 'random but — did you end up starting anything or still figuring it out?'),
  ('tyson_sonnek', 4, 'text', 'one of the guys I onboarded had the exact same hesitation. took him 2 weeks to decide, lost 11 lbs in his first 4. dont be him lol'),
  ('tyson_sonnek', 4, 'text', 'what would actually make this a yes for you rn?');

-- Slot 5 (+120h15m): MEME slot — Matthew uploads via Scripts tab
