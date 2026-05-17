/**
 * SOP viewer at /sop/[slug].
 *
 * Server-fetches the SOP + a fresh signed URL, then hands off to the
 * client component for the inline preview, copy-link, download, and (for
 * admins) delete affordances.
 */

import { notFound } from "next/navigation";
import { getSopBySlug } from "@/lib/sop/data";
import SopViewer from "@/components/sop/SopViewer";

export const dynamic = "force-dynamic";

export default async function SopViewerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sop = await getSopBySlug(slug);
  if (!sop) notFound();
  return <SopViewer sop={sop} />;
}
