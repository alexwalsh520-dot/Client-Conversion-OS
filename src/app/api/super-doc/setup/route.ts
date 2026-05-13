import { getTemplate, upsertTemplate } from '@/lib/super-doc-db';
import { DEFAULT_TEMPLATE } from '@/lib/super-doc-template-default';

export async function POST() {
  const existing = await getTemplate();
  if (existing) {
    return Response.json({ message: 'Template already exists', id: existing.id });
  }

  await upsertTemplate(DEFAULT_TEMPLATE);
  const created = await getTemplate();

  console.log('[SuperDoc] Seeded default template');
  return Response.json({ ok: true, id: created?.id });
}
