import { getTemplate, upsertTemplate } from '@/lib/super-doc-db';
import { getInitialTemplateContent } from '@/lib/super-doc-template-variants';

export async function POST() {
  const existing = await getTemplate();
  if (existing) {
    return Response.json({ message: 'Template already exists', id: existing.id });
  }

  await upsertTemplate(getInitialTemplateContent());
  const created = await getTemplate();

  console.log('[SuperDoc] Seeded default template');
  return Response.json({ ok: true, id: created?.id });
}
