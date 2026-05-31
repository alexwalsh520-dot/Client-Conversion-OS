# Studio 2.0 Suggested Ads Contract

This is the handoff point for the future Ads-tab/cloud-account project. Studio 2.0 does not need to know how the Ads tab calculates winners yet. It only needs a normalized suggestion payload.

## Flow

1. The Ads/Cloud system finds winning patterns.
2. It posts one suggestion per ad idea to `POST /api/studio-2/suggestions`.
3. The Studio 2.0 home page can list them with `GET /api/studio-2/suggestions?status=ready`.
4. Clicking a suggestion can read details with `GET /api/studio-2/suggestions/:id`.
5. Opening it as an editable Studio project uses `POST /api/studio-2/suggestions/:id/promote`.

## Payload

```json
{
  "sourceKey": "meta:tyson:act_123:ad_456:2026-06-01",
  "clientKey": "tyson",
  "title": "Summer shred free challenge angle",
  "summary": "Close variation of the highest-spend free challenge creative.",
  "offerType": "Lead Magnet",
  "score": 94,
  "thumbnailUrl": "https://...",
  "copyText": "First text block\n\nSecond text block\n\n-----\n\nOptional next ad",
  "draft": {},
  "sourceRefs": [
    {
      "source": "ads_tracker",
      "id": "ad_456",
      "label": "Winning Meta ad",
      "spend": 3999,
      "url": "https://..."
    }
  ],
  "inputSnapshot": {
    "dateRange": "last_30_days",
    "metrics": {
      "spend": 3999,
      "clicks": 812
    }
  },
  "reasoning": {
    "headline": "This repeats the working free-challenge promise.",
    "whyThisShouldWork": [
      "The original ad already earned high spend.",
      "The copy keeps the same offer but changes the hook."
    ],
    "sourcePattern": "Direct hook, simple offer stack, DM CTA.",
    "offerRead": "Lead magnet/free challenge.",
    "creativeDirection": "Use the same Instagram Story text-highlight style.",
    "copyDirection": "Make a close variation, not a wild rewrite.",
    "risks": ["Do not cover the face or main body in the image."],
    "nextStep": "Open in Studio and adjust placement by eye.",
    "confidence": 0.88
  }
}
```

## Notes

- `sourceKey` is unique and should be deterministic so the Ads system can safely upsert the same suggestion without creating duplicates.
- `draft` can be a full Studio 2.0 draft when the generator already knows the exact ad layout. If it is empty, Studio can still create a project from the `copyText`.
- `reasoning` is intentionally structured so the UI can show plain-English “why this ad exists” without scraping a paragraph.
- The table is `studio2_suggested_ads`, added in migration `041_studio2_suggested_ads.sql`.
