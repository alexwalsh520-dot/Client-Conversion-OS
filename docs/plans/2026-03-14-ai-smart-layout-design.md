# AI Smart Layout — Design Doc

## Problem
Every new ad batch requires manually positioning text blocks from scratch on each photo. Each photo has the subject in a different position, so the same copy needs different placement per photo. This takes minutes of tedious drag-and-adjust work that could be eliminated.

## Solution
Claude Haiku vision analyzes each uploaded photo to identify where the person is and where open space exists. The existing layout engine then places text blocks into those open zones using the established style defaults. The AI is just eyes — it finds the space. The code fills it.

## Architecture

### New API Route: `POST /api/ads/analyze-photo`

**Input:**
- `photoBase64`: the photo as a base64 data URL (already available from the file reader)
- `textBlockCount`: how many text blocks need to be placed (so the AI knows how many zones to find)

**Processing:**
- Sends the image to Claude Haiku with vision
- System prompt instructs it to return a spatial map of the person's position and available open zones
- Hard rule in prompt: never suggest placement below y=1440 (IG story dead zone, bottom 25%)

**Claude returns structured JSON:**
```json
{
  "subject": {
    "side": "center-right",
    "topY": 300,
    "bottomY": 1500
  },
  "openZones": [
    { "anchor": "top-left", "x": 60, "y": 60, "maxWidth": 520, "height": 300 },
    { "anchor": "mid-left", "x": 60, "y": 450, "maxWidth": 480, "height": 500 },
    { "anchor": "lower-center", "x": 60, "y": 1050, "maxWidth": 960, "height": 350 }
  ]
}
```

**Model:** Claude 3.5 Haiku (fast, cheap, strong vision). ~1-2 seconds per photo.

**Cost:** ~$0.02-0.04 per photo. A 10-photo batch = ~$0.30.

### Layout Engine Changes (in `ads/page.tsx`)

The existing `handleGenerate` → `makeBlock` → `layoutBlocks` pipeline gets a new path:

1. If AI analysis is available for a photo, `layoutBlocks` uses the `openZones` to position blocks:
   - Title block → largest zone near the top
   - Body/bullets → largest zone in the middle
   - CTA → lowest zone (but above 1440 dead zone)
   - Each block's `x`, `y`, and `maxWidth` come from the zone data
2. If AI analysis fails or times out, fall back to the current default vertical layout (no regression)

### Style stays hardcoded — AI never decides style:
- Black pill backgrounds (bgOpacity 0.85-0.95)
- White bold text, Inter font family
- Font sizing by role: title=52, body=30, callout=38, CTA=40
- Border radius, padding, alignment — all from existing `makeBlock` defaults

## UX Flow

### Setup Page (no visual changes)
1. Upload photos
2. Paste copy
3. Hit "Generate N Ads"

### Generation (new behavior)
1. Loading state: "Analyzing photo 1 of N..." with progress
2. Photos analyzed in parallel (Promise.allSettled)
3. Layout engine positions blocks using AI spatial data
4. User lands in editor with pre-positioned layouts

### Editor (one new button)
- Toolbar gets a sparkle "Re-layout" button
- Re-runs AI analysis on current photo and repositions blocks
- Useful after swapping a photo or wanting a fresh take

### Failure mode
- If AI call fails for any photo, that photo gets the default vertical layout
- No error toast needed — it just silently falls back
- User can always manually reposition regardless

## Hard Rules (baked into system prompt)
1. Bottom 25% of canvas (below y=1440 of 1920) is a dead zone — never place text there (Instagram story CTA overlay)
2. Never suggest placing text over the subject's face
3. Prefer stacking text on one side of the subject rather than splitting across both sides
4. Each zone must be at least 400px wide for readability
5. Return zones from top to bottom to maintain natural reading flow

## Files to Create/Modify
1. **NEW:** `src/app/api/ads/analyze-photo/route.ts` — API route calling Claude Haiku vision
2. **MODIFY:** `src/app/ads/page.tsx` — update `handleGenerate` to call analysis, update `layoutBlocks` to use zones, add Re-layout button, add loading state
3. **VERIFY:** `.env.local` already has `ANTHROPIC_API_KEY`

## Testing
- Upload a photo of Tyson centered → expect text stacked to one side
- Upload a photo with subject on the left → expect text on the right
- Upload 8 diverse photos → expect different layouts per photo, all avoiding the dead zone
- Kill network → expect graceful fallback to default layout
