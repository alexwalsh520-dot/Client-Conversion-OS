import { getTemplate, upsertTemplate } from '@/lib/super-doc-db';
import type { SuperDocTemplateContent } from '@/lib/super-doc-types';
import {
  getTemplateContentForVariant,
  mergeTemplateContentForVariant,
  normalizeTemplateVariant,
} from '@/lib/super-doc-template-variants';

export async function GET(req: Request) {
  const variant = normalizeTemplateVariant(new URL(req.url).searchParams.get('variant'));
  const template = await getTemplate();
  if (!template) {
    return Response.json({ error: 'Template not initialized. POST /api/super-doc/setup first.' }, { status: 404 });
  }
  return Response.json({
    ...template,
    variant,
    content: getTemplateContentForVariant(template.content, variant),
  });
}

export async function PUT(req: Request) {
  const variant = normalizeTemplateVariant(new URL(req.url).searchParams.get('variant'));
  const body = await req.json() as { content: SuperDocTemplateContent };
  if (!body.content) {
    return Response.json({ error: 'Missing content' }, { status: 400 });
  }
  const existing = await getTemplate();
  await upsertTemplate(mergeTemplateContentForVariant({
    existingRootContent: existing?.content,
    variant,
    content: body.content,
  }));
  return Response.json({ ok: true, variant });
}
