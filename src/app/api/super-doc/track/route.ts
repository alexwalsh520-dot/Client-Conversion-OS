import { trackView } from '@/lib/super-doc-db';

export async function POST(req: Request) {
  const { slug } = await req.json() as { slug: string };
  if (!slug) return Response.json({ error: 'Missing slug' }, { status: 400 });
  await trackView(slug);
  return Response.json({ ok: true });
}
