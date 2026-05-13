import { getTemplate, upsertTemplate } from '@/lib/super-doc-db';
import type { SuperDocTemplateContent } from '@/lib/super-doc-types';

export async function GET() {
  const template = await getTemplate();
  if (!template) {
    return Response.json({ error: 'Template not initialized. POST /api/super-doc/setup first.' }, { status: 404 });
  }
  return Response.json(template);
}

export async function PUT(req: Request) {
  const body = await req.json() as { content: SuperDocTemplateContent };
  if (!body.content) {
    return Response.json({ error: 'Missing content' }, { status: 400 });
  }
  await upsertTemplate(body.content);
  return Response.json({ ok: true });
}
