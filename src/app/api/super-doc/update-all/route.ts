import { getTemplate, updateAllLeadSnapshots, upsertTemplate } from '@/lib/super-doc-db';
import type { SuperDocTemplateContent } from '@/lib/super-doc-types';

export async function POST(req: Request) {
  const body = await req.json() as { content: SuperDocTemplateContent };
  if (!body.content) {
    return Response.json({ error: 'Missing content' }, { status: 400 });
  }

  await upsertTemplate(body.content);
  const count = await updateAllLeadSnapshots(body.content);

  console.log(`[SuperDoc] Updated template + ${count} lead snapshots`);
  return Response.json({ ok: true, leadsUpdated: count });
}
