# UTARI ↔ CCOS Foundation (MCP server)

A read-only MCP server that gives an external AI agent (UTARI) accurate, live context on the business:
per-ad status/spend/closes/ROAS, the on-image ad copy, every DM tied to its ad, and the sales ledger.

## What it exposes (and what it deliberately does NOT)

Tools:
- `list_ads(client)` — complete per-ad state from `ad_state`: on/off, spend, 7-day spend, leads, closes, cash, ROAS, on-image copy.
- `get_ad(client, keyword)` — one ad's full state + a sample of the DM conversations it started.
- `get_dms_for_ad(client, keyword)` — every DM conversation for an ad, full thread.
- `list_sales(client)` — the sales ledger with call notes.
- `freshness()` — minutes since each source last synced.

**Accuracy note (important):** these layers are individually trustworthy. The one thing this server does
NOT provide is a per-person "this exact DM led to this exact sale" join — that is not accurate yet
because the DM (Instagram id), ad-event (ManyChat/GHL id), and sale (GHL id) systems do not share a key
(only ~24 of 332 sales bridge to a DM deterministically). Faking that join would inject error, so it is
excluded on purpose. Fixing it is a forward data-capture change (write the ManyChat subscriber id into
the booking link + sale), not a query — tracked as a CMO open loop.

Money is the reconciled per-ad figure from `ad_state` (collected cash / Meta spend). The deep canonical
ROAS/CAC lives in the CCOS Deep Dive and is never re-derived here.

## Setup

```
cd mcp-utari
npm install
```

Set two env vars (read-only service role, server-side only, never ship to a browser):
```
SUPABASE_URL=...            # the CCOS Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=...
```

## Connect it to UTARI

Register it as a stdio MCP server in UTARI's integrations/MCP config, e.g.:
```json
{
  "mcpServers": {
    "ccos-foundation": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-utari/index.mjs"],
      "env": { "SUPABASE_URL": "...", "SUPABASE_SERVICE_ROLE_KEY": "..." }
    }
  }
}
```

If UTARI is a hosted agent that can't run a local stdio process, wrap `index.mjs`'s tools behind an
HTTP endpoint (or deploy this as a small always-on service) and point UTARI at that URL instead. The
tool logic stays identical; only the transport changes.

## Guardrails baked in
- Read-only (no write tools, no mutations).
- Returns canonical/reconciled numbers, never lets the agent math on raw spend/revenue.
- One creator at a time; DM contents are real, so treat this as sensitive.
