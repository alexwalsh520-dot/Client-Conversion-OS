import { NextRequest, NextResponse } from 'next/server';

const SYNC_ROUTES = [
  '/api/sync/mozi/stripe',
  '/api/sync/mozi/whop',
  '/api/sync/mozi/mercury',
  '/api/sync/mozi/meta',
  '/api/sync/sales-tracker-rows',
  '/api/sync/ads-tracker',
  '/api/sync/mozi/ghl',
  '/api/sync/mozi/sheets',
  '/api/sync/mozi/snapshot', // must run last, after all data is synced
];

function getBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    // VERCEL_URL does not include protocol
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const baseUrl = getBaseUrl();
  const results: Record<string, { ok: boolean; status: number; body: unknown }> = {};
  const startedAt = Date.now();

  for (const route of SYNC_ROUTES) {
    const url = `${baseUrl}${route}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
          'x-cron-secret': process.env.CRON_SECRET ?? '',
        },
      });

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }

      results[route] = {
        ok: res.ok,
        status: res.status,
        body,
      };

      if (!res.ok) {
        console.error(`Sync ${route} failed:`, res.status, body);
      }
    } catch (err) {
      console.error(`Sync ${route} error:`, err);
      results[route] = {
        ok: false,
        status: 0,
        body: { error: String(err) },
      };
    }
  }

  const elapsed = Date.now() - startedAt;
  const allOk = Object.values(results).every((r) => r.ok);

  return NextResponse.json({
    ok: allOk,
    elapsed_ms: elapsed,
    synced_at: new Date().toISOString(),
    results,
  });
}
