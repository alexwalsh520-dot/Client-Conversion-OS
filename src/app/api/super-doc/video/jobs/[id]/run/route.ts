import { getVideoJob } from '@/lib/super-doc-video-automation';
import { triggerVideoWorkerForJob } from '@/lib/super-doc-video-worker-trigger';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getVideoJob(id);

  if (!job) {
    return Response.json({ error: 'Video job not found' }, { status: 404 });
  }

  if (job.status !== 'clips_ready') {
    return Response.json(
      {
        error: 'This job needs both Higgsfield clips before the cloud worker can run.',
        status: job.status,
      },
      { status: 400 },
    );
  }

  const result = await triggerVideoWorkerForJob(id);
  return Response.json({ ok: result.triggered, result });
}
