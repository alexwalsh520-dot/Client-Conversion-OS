# DM Setter Follow-Up Queue

This is the simple flow:

1. Setter adds the ManyChat tag `Follow Up Queue`.
2. ManyChat calls CCOS.
3. CCOS creates or reuses one open GHL opportunity in the `DM Setter Pipeline`.
4. CCOS adds one contact note with only the Instagram DM deep link, like `https://ig.me/m/example_user`.
5. When the lead replies, ManyChat removes the tag and calls CCOS again.
6. CCOS removes matching GHL opportunities from the `DM Setter Pipeline`.
7. If the setter adds the tag again later, CCOS creates one new opportunity again.

## Required Vercel Env Vars

- `DM_SETTER_GHL_API_KEY`, preferred
- `DM_SETTER_GHL_LOCATION_ID`, preferred
- `GHL_API_KEY`, fallback
- `GHL_LOCATION_ID`, fallback
- `MANYCHAT_WEBHOOK_SECRET`
- `DM_SETTER_GHL_PIPELINE_NAME`, optional, defaults to `DM Setter Pipeline`
- `DM_SETTER_GHL_ACTIVE_STAGE_NAME`, optional, defaults to `Active`

The GHL token must have these scopes:

- `contacts.readonly`
- `contacts.write`
- `opportunities.readonly`
- `opportunities.write`
- `locations/customFields.readonly`

## ManyChat: Tag Added

Use this URL:

```txt
https://client-conversion-os.vercel.app/api/dm-setter/followup-queue-added
```

Headers:

```txt
Content-Type: application/json
x-manychat-secret: <MANYCHAT_WEBHOOK_SECRET>
```

Body:

```json
{
  "client": "tyson_sonnek",
  "subscriber_id": "{{Contact ID}}",
  "first_name": "{{First Name}}",
  "last_name": "{{Last Name}}",
  "instagram_handle": "{{Username}}"
}
```

CCOS automatically turns `client: "tyson_sonnek"` into source `Manychat - Tyson Sonnek`.
CCOS also writes a GHL contact note with only `https://ig.me/m/{{Username}}`.

## ManyChat: Lead Replied

Use this URL:

```txt
https://client-conversion-os.vercel.app/api/dm-setter/reply-received
```

Headers:

```txt
Content-Type: application/json
x-manychat-secret: <MANYCHAT_WEBHOOK_SECRET>
```

Body:

```json
{
  "client": "tyson_sonnek",
  "subscriber_id": "{{Contact ID}}",
  "first_name": "{{First Name}}",
  "last_name": "{{Last Name}}",
  "instagram_handle": "{{Username}}"
}
```

## ManyChat: Tag Removed Manually

If ManyChat can trigger when the `Follow Up Queue` tag is removed, call this URL:

```txt
https://client-conversion-os.vercel.app/api/dm-setter/followup-queue-removed
```

Use the same headers and body as `Lead Replied`.

## Optional Fields

Only use these if you want to override the default behavior:

```json
{
  "client_name": "Tyson Sonnek",
  "source": "Manychat - Tyson Sonnek",
  "manychat_inbox_url": "optional direct ManyChat chat URL",
  "meta_business_suite_url": "optional Meta Business Suite thread URL"
}
```

## Client Values

Only change the `client` value:

- Tyson Sonnek: `tyson_sonnek`
- Keith Holland: `keith_holland`
- Lucy Hubbard: `lucy_hubbard`
- Antwan: `antwan`

Do not run a separate GHL workflow that also creates the same opportunity, or duplicates can happen.
