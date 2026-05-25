import { getServiceSupabase } from './supabase';
import type { SuperDocTemplateContent, SuperDocLead, SuperDocTemplate, SuperDocTrackEventInput } from './super-doc-types';
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
  instagram_handle?: string;
  instagram_url?: string;
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
  await trackSuperDocEvent({ slug, event_type: 'open' });
}

function numberFromEvent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function bestEffortInsertEvent(input: SuperDocTrackEventInput) {
  const { error } = await db()
    .from('super_doc_events')
    .insert({
      lead_slug: input.slug,
      event_type: input.event_type,
      event_data: input.event_data || {},
    });

  if (error) {
    console.warn(`[SuperDoc] Event table not ready or insert failed: ${error.message}`);
  }
}

async function bestEffortUpdateLead(slug: string, updates: Record<string, unknown>) {
  const { error } = await db()
    .from('super_doc_leads')
    .update(updates)
    .eq('slug', slug);

  if (error) {
    console.warn(`[SuperDoc] Analytics columns not ready or update failed: ${error.message}`);
  }
}

export async function trackSuperDocEvent(input: SuperDocTrackEventInput): Promise<SuperDocLead | null> {
  const slug = input.slug;
  const lead = await getLeadBySlug(slug);
  if (!lead) return null;

  const eventData = input.event_data || {};
  const now = new Date().toISOString();

  await bestEffortInsertEvent(input);

  if (input.event_type === 'open') {
    const updates: Record<string, unknown> = {
      view_count: (lead.view_count || 0) + 1,
    };
    if (!lead.opened_at) {
      updates.opened_at = now;
    }

    await db()
      .from('super_doc_leads')
      .update(updates)
      .eq('slug', slug);

    const nextLead = {
      ...lead,
      ...updates,
    } as SuperDocLead;
    console.log(`[SuperDoc] View tracked: ${slug} (count: ${updates.view_count})`);
    return nextLead;
  }

  if (input.event_type === 'read_progress') {
    const percent = Math.max(0, Math.min(100, Math.round(numberFromEvent(eventData.percent) || 0)));
    const current = lead.max_scroll_percent || 0;
    if (percent > current) {
      await bestEffortUpdateLead(slug, {
        max_scroll_percent: percent,
        last_read_at: now,
      });
      return { ...lead, max_scroll_percent: percent, last_read_at: now };
    }
    return lead;
  }

  if (
    input.event_type === 'video_play' ||
    input.event_type === 'video_progress' ||
    input.event_type === 'video_pause' ||
    input.event_type === 'video_complete'
  ) {
    const percent = Math.max(0, Math.min(100, Math.round(numberFromEvent(eventData.percent) || 0)));
    const seconds = Math.max(0, numberFromEvent(eventData.seconds) || 0);
    const currentPercent = lead.video_watch_percent || 0;
    const currentSeconds = lead.video_watch_seconds || 0;
    const updates: Record<string, unknown> = {
      last_video_event_at: now,
    };

    if (input.event_type === 'video_play') {
      updates.video_play_count = (lead.video_play_count || 0) + 1;
    }
    if (percent > currentPercent) {
      updates.video_watch_percent = percent;
    }
    if (seconds > currentSeconds) {
      updates.video_watch_seconds = seconds;
    }

    await bestEffortUpdateLead(slug, updates);
    return { ...lead, ...updates } as SuperDocLead;
  }

  return lead;
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
