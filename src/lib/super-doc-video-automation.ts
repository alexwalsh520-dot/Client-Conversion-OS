import { getServiceSupabase } from './supabase';
import { capitalizeNamePart } from './super-doc-name';
import { getSuperDocSegment, normalizeInstagramHandle, type SuperDocSegment } from './super-doc-routing';

function db() {
  return getServiceSupabase();
}

export type SuperDocVideoJobStatus =
  | 'queued'
  | 'waiting_for_clips'
  | 'clips_ready'
  | 'editing'
  | 'uploaded'
  | 'delivered'
  | 'failed'
  | 'skipped';

export interface SuperDocVideoTemplate {
  id: string;
  segment: Exclude<SuperDocSegment, 'unknown'>;
  name: string;
  base_video_source: string | null;
  reference_clip_1_source: string | null;
  reference_clip_2_source: string | null;
  total_duration_seconds: number;
  clip_1_start_seconds: number;
  clip_1_end_seconds: number;
  clip_2_start_seconds: number;
  clip_2_end_seconds: number;
  higgsfield_model: string;
  clip_1_script_template: string;
  clip_2_script_template: string;
  clip_1_prompt_template: string;
  clip_2_prompt_template: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SuperDocVideoJob {
  id: string;
  run_id: string | null;
  lead_slug: string | null;
  segment: Exclude<SuperDocSegment, 'unknown'>;
  first_name: string;
  last_name: string;
  email: string;
  instagram_handle: string | null;
  template_id: string | null;
  status: SuperDocVideoJobStatus;
  higgsfield_clip_1_url: string | null;
  higgsfield_clip_2_url: string | null;
  final_video_url: string | null;
  bunny_embed_url: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  template?: SuperDocVideoTemplate | null;
}

export interface CreateSuperDocVideoJobInput {
  runId?: string;
  leadSlug?: string;
  firstName: string;
  lastName?: string;
  email?: string;
  leadType: string;
  instagramHandle?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateSuperDocVideoJobInput {
  lead_slug?: string | null;
  status?: SuperDocVideoJobStatus;
  higgsfield_clip_1_url?: string | null;
  higgsfield_clip_2_url?: string | null;
  final_video_url?: string | null;
  bunny_embed_url?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export type UpdateSuperDocVideoTemplateInput = Partial<
  Pick<
    SuperDocVideoTemplate,
    | 'name'
    | 'base_video_source'
    | 'reference_clip_1_source'
    | 'reference_clip_2_source'
    | 'total_duration_seconds'
    | 'clip_1_start_seconds'
    | 'clip_1_end_seconds'
    | 'clip_2_start_seconds'
    | 'clip_2_end_seconds'
    | 'higgsfield_model'
    | 'clip_1_script_template'
    | 'clip_2_script_template'
    | 'clip_1_prompt_template'
    | 'clip_2_prompt_template'
    | 'notes'
  >
>;

function normalizeJobSegment(leadTypeOrSegment: string): Exclude<SuperDocSegment, 'unknown'> {
  const segment = getSuperDocSegment(leadTypeOrSegment);
  return segment === 'agency_tm' ? 'agency_tm' : 'creator';
}

function rowToTemplate(row: unknown): SuperDocVideoTemplate {
  return row as SuperDocVideoTemplate;
}

function rowToJob(row: unknown): SuperDocVideoJob {
  return row as SuperDocVideoJob;
}

export async function getVideoTemplates(): Promise<SuperDocVideoTemplate[]> {
  const { data, error } = await db()
    .from('super_doc_video_templates')
    .select('*')
    .order('segment', { ascending: true });

  if (error) throw new Error(`Failed to load video templates: ${error.message}`);
  return (data || []).map(rowToTemplate);
}

export async function getVideoTemplateForSegment(
  leadTypeOrSegment: string,
): Promise<SuperDocVideoTemplate | null> {
  const segment = normalizeJobSegment(leadTypeOrSegment);
  const { data, error } = await db()
    .from('super_doc_video_templates')
    .select('*')
    .eq('segment', segment)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to load ${segment} video template: ${error.message}`);
  }

  return data ? rowToTemplate(data) : null;
}

export async function updateVideoTemplate(
  segmentInput: string,
  updates: UpdateSuperDocVideoTemplateInput,
): Promise<SuperDocVideoTemplate> {
  const segment = normalizeJobSegment(segmentInput);
  const { data, error } = await db()
    .from('super_doc_video_templates')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('segment', segment)
    .select()
    .single();

  if (error) throw new Error(`Failed to update ${segment} video template: ${error.message}`);
  return rowToTemplate(data);
}

export async function createVideoJob(input: CreateSuperDocVideoJobInput): Promise<SuperDocVideoJob> {
  const segment = normalizeJobSegment(input.leadType);
  const template = await getVideoTemplateForSegment(segment);

  const { data, error } = await db()
    .from('super_doc_video_jobs')
    .insert({
      run_id: input.runId || null,
      lead_slug: input.leadSlug || null,
      segment,
      first_name: capitalizeNamePart(input.firstName),
      last_name: capitalizeNamePart(input.lastName),
      email: input.email || '',
      instagram_handle: normalizeInstagramHandle(input.instagramHandle),
      template_id: template?.id || null,
      status: 'queued',
      metadata: {
        ...(input.metadata || {}),
        clip_1_range: [template?.clip_1_start_seconds ?? 0, template?.clip_1_end_seconds ?? 6],
        clip_2_range: [template?.clip_2_start_seconds ?? 6, template?.clip_2_end_seconds ?? 10],
        assembly_rule: 'final = clip_1 + clip_2 + base_video_from_10s_to_end',
      },
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create video job: ${error.message}`);
  return rowToJob(data);
}

export async function getVideoJob(id: string): Promise<SuperDocVideoJob | null> {
  const { data, error } = await db()
    .from('super_doc_video_jobs')
    .select('*, template:super_doc_video_templates(*)')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to load video job: ${error.message}`);
  }

  return data ? rowToJob(data) : null;
}

export async function getRecentVideoJobs(limit = 50): Promise<SuperDocVideoJob[]> {
  const { data, error } = await db()
    .from('super_doc_video_jobs')
    .select('*, template:super_doc_video_templates(*)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load video jobs: ${error.message}`);
  return (data || []).map(rowToJob);
}

export async function getVideoJobsByStatus(
  status: SuperDocVideoJobStatus,
  limit = 10,
): Promise<SuperDocVideoJob[]> {
  const { data, error } = await db()
    .from('super_doc_video_jobs')
    .select('*, template:super_doc_video_templates(*)')
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to load ${status} video jobs: ${error.message}`);
  return (data || []).map(rowToJob);
}

export async function updateVideoJob(
  id: string,
  updates: UpdateSuperDocVideoJobInput,
): Promise<SuperDocVideoJob> {
  const { data, error } = await db()
    .from('super_doc_video_jobs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*, template:super_doc_video_templates(*)')
    .single();

  if (error) throw new Error(`Failed to update video job: ${error.message}`);
  return rowToJob(data);
}

export async function attachBunnyVideoToLead(input: {
  leadSlug: string;
  bunnyEmbedUrl: string;
}): Promise<void> {
  const { error } = await db()
    .from('super_doc_leads')
    .update({ video_url: input.bunnyEmbedUrl })
    .eq('slug', input.leadSlug);

  if (error) throw new Error(`Failed to attach Bunny video to lead: ${error.message}`);
}
