import {
  createVideoJob,
  getRecentVideoJobs,
  type CreateSuperDocVideoJobInput,
} from '@/lib/super-doc-video-automation';

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const limit = Math.max(1, Math.min(200, Number(params.get('limit') || 50)));
  const jobs = await getRecentVideoJobs(limit);
  return Response.json({ jobs });
}

export async function POST(req: Request) {
  const body = await req.json() as CreateSuperDocVideoJobInput;

  if (!body.firstName || !body.leadType) {
    return Response.json({ error: 'Missing firstName or leadType' }, { status: 400 });
  }

  const job = await createVideoJob(body);
  return Response.json({ ok: true, job });
}
