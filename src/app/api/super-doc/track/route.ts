import { trackSuperDocEvent } from '@/lib/super-doc-db';
import { notifySuperDocActivity } from '@/lib/super-doc-slack';
import type { SuperDocEventType } from '@/lib/super-doc-types';

function getRequestBaseUrl(req: Request): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');

  if (host) return `${proto}://${host}`;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export async function POST(req: Request) {
  const {
    slug,
    event_type = 'open',
    event_data = {},
  } = await req.json() as {
    slug: string;
    event_type?: SuperDocEventType;
    event_data?: Record<string, unknown>;
  };
  if (!slug) return Response.json({ error: 'Missing slug' }, { status: 400 });
  const lead = await trackSuperDocEvent({ slug, event_type, event_data });
  if (lead) {
    const pageUrl = `${getRequestBaseUrl(req)}/super-doc/${slug}`;
    notifySuperDocActivity({ lead, eventType: event_type, eventData: event_data, pageUrl }).catch((err) => {
      console.warn('[SuperDoc] Slack notification failed:', err);
    });
  }
  return Response.json({ ok: true });
}
