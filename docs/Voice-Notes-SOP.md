# Voice Notes SOP

## What this does

This tool lets the team:

1. save a creator voice once
2. type a short DM reply
3. turn it into an ElevenLabs voice note
4. preview it
5. send it from the same page when Instagram is connected

Start with Tyson first. Add the next creators later from the same page.

## One-time admin setup

### 1. Add env vars

Add these to your app:

```bash
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
```

`ELEVENLABS_MODEL_ID` is optional. If you skip it, the app defaults to `eleven_flash_v2_5`.

### 2. Create the table

Apply the SQL in:

- [supabase/migrations/008_creator_voice_profiles.sql](/Users/matthew_conder/Documents/New project/Client-Conversion-OS/supabase/migrations/008_creator_voice_profiles.sql)

### 3. Open the tool

Go to:

- `/settings/voice-notes`

### 4. Save Tyson

Use:

- Creator name: `Tyson Sonnek`
- Slug: `tyson`
- Client key: `tyson_sonnek`

Then either:

- upload 2 to 6 clean Tyson talking clips
- or paste Tyson’s existing ElevenLabs `voice_id`

Check the permission box before saving.

## Best voice file rules

- Use clean talking audio only.
- Keep clips natural, not over-acted.
- Avoid music and loud background noise.
- 30 to 90 seconds per clip is plenty.
- 2 to 6 clips is enough for a strong start.

## Setter workflow

### Goal-clear voice note flow

1. Open `/voice-notes`.
2. Choose the creator.
3. Choose the environment.
4. Paste the Instagram username if you want to send from the page.
5. Type the exact message you want spoken.
6. Click `Generate Voice Note`.
7. Listen once.
8. Click `Send on Instagram` if the contact already messaged the connected IG account.
9. If direct send is not connected yet, click `Download MP3`.

## Instagram send setup

Add these env vars if you want the page to send the audio straight to Instagram:

```bash
INSTAGRAM_DM_ACCESS_TOKEN=your_instagram_message_token
INSTAGRAM_DM_ACCOUNT_ID=your_professional_instagram_id
INSTAGRAM_DM_API_VERSION=v24.0
```

Notes:

- The pasted username has to belong to someone who already messaged the connected Instagram account.
- The page can only send if Meta lets the app see that DM contact.
- The environment picker changes delivery a bit. It does not add real car, walk, or gym background noise yet.

## Rules for setters

- Keep notes around 10 to 25 seconds.
- One message, one job.
- Talk about their exact goal or exact problem.
- End with a clear reply question.
- Do not stack 3 questions in one note.

## Good note example

“Hey Sarah, it’s Tyson here. I saw your message and it sounds like your main goal right now is losing 20 pounds before summer. The part I want to understand better is what keeps knocking you off track. Shoot me a quick reply and tell me what you’re doing right now and where it keeps breaking down.”

## If something fails

- If the voice says `Verify`, finish the voice check in ElevenLabs first.
- If audio does not generate, check `ELEVENLABS_API_KEY`.
- If the page says no creator voices exist, make sure the SQL table was created.
- If send fails for a username, that person may not have messaged the connected Instagram account yet.

## DM funnel script phases

The client dashboard funnel on the sales hub tracks six stages, in this exact order. Every voice note and text the setter sends should map to one of these phases.

1. **New lead** — a fresh DM came in. ManyChat applies the `new_lead` tag.
2. **Challenge sent** — the lead confirms they want the free challenge and we send the Skool link. Any outbound message with a `skool.com` URL moves the lead here automatically. No manual tag needed.
3. **Replied** — the lead answers the first open-ended question ("What made you interested in the challenge?"). ManyChat applies the `lead_engaged` tag.
4. **In discovery** — the setter sends the discovery opener (voice note or text) and the lead responds with real content — their goal, current situation, or what's holding them back. One-word replies like "yeah", "ok", emoji, or "interested" do **not** count. AI reads the conversation and decides. See `src/lib/dm-stage-ai.ts`.
5. **Call link sent** — the setter sends the booking link. ManyChat applies the `call_link_sent` tag, and any outbound booking URL is also auto-detected.
6. **Booked** — the lead booked a call. Confirmed from GHL calendar or the sales tracker.

### Rules for writing messages in each phase

- **Challenge sent**: keep the delivery message short. One line, the link, then the open-ended question in a separate bubble. Do not stack.
- **Replied → In discovery**: when the lead answers "what made you interested", the very next message should be the discovery voice note. That note asks for goal + what keeps them stuck, one question each. No stacked questions.
- **In discovery → Call link sent**: do not send the booking link until the AI-detected `in_discovery` is true. If the lead is one-word replying, you have not earned the call yet — ask a better question.

### How to read drop-offs

- **New lead → Challenge sent** low: your initial confirmation script is dying. Either the first "are you here for the challenge" line is unclear or people are ghosting before answering.
- **Challenge sent → Replied** low: the challenge was sent but the open-ended question did not pull a reply. Rewrite the question.
- **Replied → In discovery** low: they answered the easy question but not the real one. The voice note is too broad, too long, or too robotic. This is the biggest lever on revenue.
- **In discovery → Call link sent** low: setter is earning the conversation but not asking for the call. Script the bridge.
- **Call link sent → Booked** low: the link copy or landing page is the problem, not the DM.
