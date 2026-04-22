-- Seed variants for Amara (client: tyson_sonnek).
-- Voice based on her actual DM patterns: casual, "yo", "g", "aight", "^", short bursts, name pings.
-- Five variants per slot so no lead ever sees a dupe across the 4-send sequence.

insert into followup_variants (client, slot, type, body, note) values
  -- Slot 2 (T+15m): soft nudge, catch while attention is warm
  ('tyson_sonnek', 2, 'text', '^',                                                        'bump — Amara''s actual go-to'),
  ('tyson_sonnek', 2, 'text', 'you still there g?',                                        'casual check-in'),
  ('tyson_sonnek', 2, 'text', 'yo did I lose you',                                         'playful'),
  ('tyson_sonnek', 2, 'text', 'still good?',                                               'minimalist'),
  ('tyson_sonnek', 2, 'text', 'all good?',                                                 'her actual line'),

  -- Slot 3 (T+24h15m): wake them up with a direct question
  ('tyson_sonnek', 3, 'text', 'yo you still tryna join the challenge or nah?',             'Amara opener reframed'),
  ('tyson_sonnek', 3, 'text', 'what''s your main physique goal tho? where you tryna be in 3-6 months?', 'her qualifier'),
  ('tyson_sonnek', 3, 'text', 'aight real quick — what''s actually holding you back rn? food, training, or consistency?',  'directness'),
  ('tyson_sonnek', 3, 'text', 'sounds like you need a real strategy not more info. that track for you?', 'her reframe'),
  ('tyson_sonnek', 3, 'text', 'did you manage to get a spot?',                             'urgency nudge'),

  -- Slot 4 (T+72h15m): pattern interrupt — come back different
  ('tyson_sonnek', 4, 'text', 'random but — did you end up starting anything or still figuring it out?', 'pattern break'),
  ('tyson_sonnek', 4, 'text', 'not chasing promise. just curious if life got in the way or you''re still in', 'permission'),
  ('tyson_sonnek', 4, 'text', 'one of the guys I onboarded had the exact same hesitation. took him 2 weeks to decide, lost 11 lbs in his first 4. dont be him lol', 'social proof'),
  ('tyson_sonnek', 4, 'text', 'what would actually make this a yes for you rn?',           'close-the-loop Q'),
  ('tyson_sonnek', 4, 'text', 'door''s still open whenever g',                             'low-pressure'),

  -- Slot 5 (T+120h15m): hail mary — clean exit either way
  ('tyson_sonnek', 5, 'text', 'alright last msg from me — yes/no/maybe and I''ll leave you alone 🤝',     'clean-close'),
  ('tyson_sonnek', 5, 'text', 'if now''s not the time I totally get it, just lmk and I''ll stop messaging', 'respectful'),
  ('tyson_sonnek', 5, 'text', 'gonna assume you passed for now — if that changes my dms are open',        'soft-quit'),
  ('tyson_sonnek', 5, 'text', 'hey genuine q — did I say something off or is the timing just bad?',       'self-aware'),
  ('tyson_sonnek', 5, 'text', 'next group kicks off soon. after that the price goes up. figured you''d wanna know 🤷‍♂️', 'scarcity')
on conflict do nothing;
