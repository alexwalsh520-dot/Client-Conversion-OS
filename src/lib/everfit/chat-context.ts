import { getServiceSupabase } from '@/lib/supabase';
import { HttpError } from './server';
import { scopeReport } from './access';
import { daysUntil, isRetentionWindow, pkDate } from './validation';
import type { AccessContext, ClientSnapshot, EverfitBrief, EverfitReport } from './types';

export function retentionFacts(clients: ClientSnapshot[], today = pkDate()) {
  return clients.map(c => ({ id: c.id, name: c.name, days_remaining: daysUntil(c.end_date, today), in_retention_window: isRetentionWindow(daysUntil(c.end_date, today)) }));
}

export async function loadChatContext(access: AccessContext, coach?: string) {
  if (coach && !access.admin && !access.coaches.includes(coach)) throw new HttpError('Coach view unavailable.', 403);
  const db = getServiceSupabase();
  const roster: (ClientSnapshot & {comments: string | null})[] = [];
  for (let offset = 0; ; offset += 500) {
    let q = db.from('clients').select('id,name,email,coach_name,program,start_date,end_date,status,comments,amount_paid,offer,onboarding_status').order('id').range(offset, offset + 499);
    if (coach) q = q.eq('coach_name', coach);
    else if (!access.admin) q = q.in('coach_name', access.coaches);
    const {data, error} = await q;
    if (error) throw error;
    roster.push(...(data ?? []) as typeof roster);
    if ((data?.length ?? 0) < 500) break;
    if (roster.length >= 2000) throw new HttpError('Select a coach to narrow the context.', 422);
  }
  let query = db.from('everfit_reports').select('id,coach_name,review_date,imported_at,document').order('review_date', {ascending:false}).order('imported_at', {ascending:false}).limit(101);
  if (coach) query = query.eq('coach_name', coach);
  else if (!access.admin) query = query.in('coach_name', access.coaches);
  const {data: reports, error} = await query;
  if (error) throw error;
  const latest = new Map<string, {report_id:string; review_date:string; client:EverfitBrief}>();
  const history: unknown[] = [];
  const coverage: unknown[] = [];
  for (const r of (reports ?? []).slice(0,100)) {
    const doc = scopeReport(r.document as EverfitReport, access, roster);
    coverage.push({report_id:r.id, coach:r.coach_name, review_date:r.review_date, imported_at:r.imported_at, precision:doc.precision, notes:doc.coverage_notes});
    for (const c of doc.clients) {
      const key = `${r.coach_name}:${c.everfit_id}`;
      const brief = {...c, email:null, ccos_snapshot:null};
      if (!latest.has(key)) latest.set(key, {report_id:r.id, review_date:r.review_date, client:brief});
      else history.push({report_id:r.id, review_date:r.review_date, coach:r.coach_name, everfit_id:c.everfit_id, name:c.name, summary:c.summary, next_step:c.next_step});
    }
  }
  // Restrict supplemental records by the currently authorized roster, never by supplied IDs.
  const ids = roster.map(c => c.id);
  const meetings: unknown[] = [];
  const finances: unknown[] = [];
  let supplementalTruncated = false;
  for (let i=0; i<ids.length; i+=200) {
    const batch = ids.slice(i,i+200);
    const results = await Promise.all([
      db.from('coach_meetings').select('id,client_id,coach_name,meeting_date,notes').in('client_id',batch).order('meeting_date',{ascending:false}).limit(501),
      db.from('finances').select('id,client_id,amount_paid,refund_amount,refund_reason,refund_date,retention_revenue,retention_date').in('client_id',batch).order('id').limit(501),
    ]);
    for (const result of results) if (result.error) throw result.error;
    supplementalTruncated ||= results.some(r=>(r.data?.length ?? 0)>500);
    meetings.push(...(results[0].data ?? []).slice(0,500));
    finances.push(...(results[1].data ?? []).slice(0,500));
  }
  const facts = retentionFacts(roster);
  const context = {
    today_pkt:pkDate(), scope:coach || (access.admin?'All coaches':access.coaches),
    rules:{retention_days_remaining_min:-10,retention_days_remaining_max:10, window_membership_is_not_retention_outcome:true},
    counts:{ccos_clients:roster.length,clients_in_retention_date_window:facts.filter(c=>c.in_retention_window).length,everfit_clients_with_saved_briefs:latest.size},
    roster:roster.map(c=>({...c,email:undefined})), date_facts:facts,
    latest_everfit:[...latest.values()], past_everfit:history, report_coverage:coverage,
    meetings, finances,
    limitations:{report_history_limited_to_latest_100:(reports?.length ?? 0)>100,supplemental_records_truncated:supplementalTruncated, raw_conversations_available:false, eods_and_milestones_not_reliable:true, absence_of_retention_discussion_in_a_summary_does_not_prove_no_outreach:true},
  };
  if (JSON.stringify(context).length>450000) throw new HttpError('This context is too large. Select a specific coach and try again.',422);
  return context;
}
