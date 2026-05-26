import {
  getVideoJob,
  updateVideoJob,
  type UpdateSuperDocVideoJobInput,
} from '@/lib/super-doc-video-automation';
import { triggerVideoWorkerForJob } from '@/lib/super-doc-video-worker-trigger';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getVideoJob(id);
  if (!job) return Response.json({ error: 'Video job not found' }, { status: 404 });
  return Response.json({ job });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const updates = await req.json() as UpdateSuperDocVideoJobInput;
  const job = await updateVideoJob(id, updates);
  const shouldTriggerWorker =
    updates.status === 'clips_ready' &&
    Boolean(job.higgsfield_clip_1_url) &&
    Boolean(job.higgsfield_clip_2_url);

  const workerTrigger = shouldTriggerWorker
    ? await triggerVideoWorkerForJob(id)
    : null;

  return Response.json({ ok: true, job, workerTrigger });
}
