import VisualSuperDocEditor from './VisualSuperDocEditor';
import { normalizeTemplateVariant } from '@/lib/super-doc-template-variants';

interface Props {
  searchParams: Promise<{ variant?: string }>;
}

export default async function SuperDocEditorPage({ searchParams }: Props) {
  const params = await searchParams;
  return <VisualSuperDocEditor mode="template" variant={normalizeTemplateVariant(params.variant)} />;
}
