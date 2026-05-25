import VisualSuperDocEditor from '../VisualSuperDocEditor';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function SuperDocLeadEditorPage({ params }: Props) {
  const { slug } = await params;
  return <VisualSuperDocEditor mode="lead" slug={slug} />;
}
