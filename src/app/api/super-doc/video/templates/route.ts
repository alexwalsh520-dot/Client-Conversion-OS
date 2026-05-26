import {
  getVideoTemplates,
  updateVideoTemplate,
  type UpdateSuperDocVideoTemplateInput,
} from '@/lib/super-doc-video-automation';

export async function GET() {
  const templates = await getVideoTemplates();
  return Response.json({ templates });
}

export async function PUT(req: Request) {
  const body = await req.json() as {
    segment?: string;
    updates?: UpdateSuperDocVideoTemplateInput;
  };

  if (!body.segment) {
    return Response.json({ error: 'Missing segment' }, { status: 400 });
  }
  if (!body.updates || typeof body.updates !== 'object') {
    return Response.json({ error: 'Missing updates' }, { status: 400 });
  }

  const template = await updateVideoTemplate(body.segment, body.updates);
  return Response.json({ ok: true, template });
}
