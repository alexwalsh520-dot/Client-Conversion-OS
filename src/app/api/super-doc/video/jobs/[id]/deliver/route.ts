import { deliverSuperDocLead } from '@/lib/super-doc-delivery';
import { getLeadBySlug } from '@/lib/super-doc-db';
import { getVideoJob, updateVideoJob } from '@/lib/super-doc-video-automation';

function getRequestBaseUrl(req: Request): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');

  if (host) return `${proto}://${host}`;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getVideoJob(id);
  if (!job) return Response.json({ error: 'Video job not found' }, { status: 404 });
  if (!job.lead_slug) return Response.json({ error: 'Video job has no Super Doc lead attached' }, { status: 400 });

  const lead = await getLeadBySlug(job.lead_slug);
  if (!lead) return Response.json({ error: 'Super Doc lead not found' }, { status: 404 });

  const videoUrl = job.bunny_embed_url || lead.video_url;
  if (!videoUrl || videoUrl === 'about:blank') {
    return Response.json({ error: 'Final Bunny video is not attached yet' }, { status: 400 });
  }

  const metadata = job.metadata || {};
  const pageUrl = readString(metadata.page_url) || `${getRequestBaseUrl(req)}/super-doc/${job.lead_slug}`;
  const testMode = metadata.test_mode === false ? false : true;

  try {
    const routeResult = await deliverSuperDocLead({
      lead: {
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        lead_type: lead.lead_type,
        instagram_handle: lead.instagram_handle || undefined,
        instagram_url: lead.instagram_url || undefined,
      },
      pageUrl,
      videoUrl,
      runId: job.run_id || undefined,
      testMode,
    });

    const updatedJob = await updateVideoJob(id, {
      status: 'delivered',
      error: null,
      metadata: {
        ...metadata,
        delivered_at: new Date().toISOString(),
        delivery_result: routeResult,
      },
    });

    return Response.json({ ok: true, job: updatedJob, routeResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delivery failed';
    await updateVideoJob(id, {
      status: 'failed',
      error: message,
      metadata: {
        ...metadata,
        delivery_failed_at: new Date().toISOString(),
      },
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
