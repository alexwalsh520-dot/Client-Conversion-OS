import { getTemplate, updateLeadSnapshotsForTemplateVariant, upsertTemplate } from '@/lib/super-doc-db';
import type { SuperDocTemplateContent } from '@/lib/super-doc-types';
import {
  getTemplateContentForVariant,
  mergeTemplateContentForVariant,
  normalizeTemplateVariant,
} from '@/lib/super-doc-template-variants';

export async function POST(req: Request) {
  const variant = normalizeTemplateVariant(new URL(req.url).searchParams.get('variant'));
  const body = await req.json() as { content: SuperDocTemplateContent };
  if (!body.content) {
    return Response.json({ error: 'Missing content' }, { status: 400 });
  }

  const existing = await getTemplate();
  const rootContent = mergeTemplateContentForVariant({
    existingRootContent: existing?.content,
    variant,
    content: body.content,
  });
  await upsertTemplate(rootContent);
  const count = await updateLeadSnapshotsForTemplateVariant(
    getTemplateContentForVariant(rootContent, variant),
    variant,
  );

  console.log(`[SuperDoc] Updated ${variant} template + ${count} lead snapshots`);
  return Response.json({ ok: true, variant, leadsUpdated: count });
}
