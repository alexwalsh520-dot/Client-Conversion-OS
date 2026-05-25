import { getServiceSupabase } from './supabase';
import type { SuperDocTemplateContent, SuperDocLead, SuperDocTemplate } from './super-doc-types';
import { getTemplateVariantForLeadType } from './super-doc-template-variants';
import type { SuperDocTemplateVariant } from './super-doc-types';

function db() {
  return getServiceSupabase();
}

export async function getTemplate(): Promise<SuperDocTemplate | null> {
  const { data } = await db()
    .from('super_doc_template')
    .select('*')
    .limit(1)
    .single();
  return data as SuperDocTemplate | null;
}

export async function upsertTemplate(content: SuperDocTemplateContent): Promise<void> {
  const existing = await getTemplate();
  if (existing) {
    await db()
      .from('super_doc_template')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await db()
      .from('super_doc_template')
      .insert({ content, updated_at: new Date().toISOString() });
  }
}

export async function getLeadBySlug(slug: string): Promise<SuperDocLead | null> {
  const { data } = await db()
    .from('super_doc_leads')
    .select('*')
    .eq('slug', slug)
    .single();
  return data as SuperDocLead | null;
}

export async function getAllLeads(): Promise<SuperDocLead[]> {
  const { data } = await db()
    .from('super_doc_leads')
    .select('*')
    .order('created_at', { ascending: false });
  return (data || []) as SuperDocLead[];
}

export async function updateLeadSnapshot(slug: string, content: SuperDocTemplateContent): Promise<void> {
  const { error } = await db()
    .from('super_doc_leads')
    .update({ content_snapshot: content })
    .eq('slug', slug);
  if (error) throw new Error(`Failed to update lead page: ${error.message}`);
}

export async function createLead(lead: {
  slug: string;
  first_name: string;
  last_name: string;
  email: string;
  lead_type: string;
  video_url: string;
  content_snapshot: SuperDocTemplateContent;
}): Promise<SuperDocLead> {
  const { data, error } = await db()
    .from('super_doc_leads')
    .insert(lead)
    .select()
    .single();
  if (error) throw new Error(`Failed to create lead: ${error.message}`);
  return data as SuperDocLead;
}

export async function trackView(slug: string): Promise<void> {
  const lead = await getLeadBySlug(slug);
  if (!lead) return;

  const updates: Record<string, unknown> = {
    view_count: (lead.view_count || 0) + 1,
  };
  if (!lead.opened_at) {
    updates.opened_at = new Date().toISOString();
  }

  await db()
    .from('super_doc_leads')
    .update(updates)
    .eq('slug', slug);

  console.log(`[SuperDoc] View tracked: ${slug} (count: ${updates.view_count})`);
}

export async function updateAllLeadSnapshots(content: SuperDocTemplateContent): Promise<number> {
  const { data, error } = await db()
    .from('super_doc_leads')
    .update({ content_snapshot: content })
    .neq('id', '')
    .select('id');
  if (error) throw new Error(`Failed to update snapshots: ${error.message}`);
  return data?.length || 0;
}

export async function updateLeadSnapshotsForTemplateVariant(
  content: SuperDocTemplateContent,
  variant: SuperDocTemplateVariant,
): Promise<number> {
  const leads = await getAllLeads();
  const matchingLeads = leads.filter((lead) => getTemplateVariantForLeadType(lead.lead_type) === variant);

  await Promise.all(matchingLeads.map((lead) => updateLeadSnapshot(lead.slug, content)));
  return matchingLeads.length;
}

export function generateSlug(firstName: string, lastName: string): string {
  return `${firstName}-${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');
}
