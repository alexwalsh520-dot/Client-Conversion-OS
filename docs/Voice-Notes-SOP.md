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
