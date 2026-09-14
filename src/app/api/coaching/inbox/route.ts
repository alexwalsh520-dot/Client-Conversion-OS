import { getServiceSupabase } from "@/lib/supabase";
import { requireAccess, requireSameOrigin, HttpError } from "@/lib/everfit/server";
import { parseInboxCapture, parseInboxBatch, MAX_INBOX_BYTES, parseSyncPlan } from "@/lib/inbox/validation";
import { record } from "@/lib/everfit/validation";
import { everfitCoach } from "@/lib/everfit/owners";
import type { InboxConversation } from "@/lib/inbox/types";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function fail(error: unknown) {
  return Response.json({ error: error instanceof HttpError ? error.message : "Inbox storage is unavailable. Connect the CCOS Supabase project and apply the inbox migration." }, { status: error instanceof HttpError ? error.status : 503 });
}
function reply(data: unknown) { return Response.json(data, { headers: { "Cache-Control": "private, no-store" } }); }
export async function GET(request: Request) {
  try {
    const access = await requireAccess(), db = getServiceSupabase(), params = new URL(request.url).searchParams;
    const id = params.get("id"), runId = params.get("runId");
    if (runId) {
      if (!access.admin) throw new HttpError("Administrator access required.",403);
      const run = await db.from("everfit_inbox_runs").select("*").eq("id",runId).eq("actor",access.email).maybeSingle();
      if (run.error) throw run.error;
      if (!run.data) throw new HttpError("Sync not found.",404);
      const items = [];
      for (let offset=0; ; offset+=1000) {
        const page=await db.from("everfit_inbox_items").select("*").eq("run_id",runId).order("everfit_id").range(offset,offset+999);
        if(page.error) throw page.error;
        items.push(...page.data);
        if(page.data.length<1000) break;
      }
      return reply({run:run.data,items});
    }
    let query = db.from("everfit_inbox_conversations").select("*").order("everfit_id");
    if (id) query = query.eq("everfit_id",id);
    if (!access.admin) query = query.in("coach_name",access.coaches);
    const offset = Number(params.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset<0) throw new HttpError("Invalid offset.",400);
    const result = await query.range(id?0:offset,id?0:offset+99);
    if (result.error) throw result.error;
    let conversations = result.data as InboxConversation[];
    if (!access.admin) {
      const ids = conversations.flatMap(c=>c.client_id===null?[]:[c.client_id]);
      const current = ids.length ? await db.from("clients").select("id,coach_name").in("id",ids) : {data:[],error:null};
      if (current.error) throw current.error;
      // Unlinked records are management-only. Recheck transfers against the current roster.
      conversations = conversations.filter(c=>current.data?.some(l=>l.id===c.client_id && l.coach_name===c.coach_name));
    }
    if (id) {
      if (!conversations.length) throw new HttpError("Conversation not found.",404);
      let messages = db.from("everfit_inbox_messages").select("message_id,sender,text,date,time,attachments").eq("everfit_id",id).order("message_id",{ascending:false}).limit(100);
      const before = params.get("before");
      if (before) messages=messages.lt("message_id",before);
      const page=await messages;
      if(page.error) throw page.error;
      return reply({conversation:conversations[0],messages:page.data.toReversed(),before:page.data.length===100?page.data.at(-1)?.message_id:null});
    }
    return reply({conversations,nextOffset:result.data.length===100?offset+100:null,admin:access.admin});
  } catch(error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const access=await requireAccess();
    if (!access.admin) throw new HttpError("Only administrators can import inbox messages.",403);
    requireSameOrigin(request);
    if(Number(request.headers.get("content-length"))>MAX_INBOX_BYTES) throw new HttpError("Import exceeds 3 MB.",413);
    const raw=await request.text();
    if(Buffer.byteLength(raw)>MAX_INBOX_BYTES) throw new HttpError("Import exceeds 3 MB.",413);
    let body: Record<string,unknown>;
    try { body=record(JSON.parse(raw)); } catch { throw new HttpError("Invalid JSON.",400); }
    const db=getServiceSupabase();
    if(body.action==="start") {
      let plan;
      try { plan=parseSyncPlan(body.plan); } catch(e) { throw new HttpError((e as Error).message,400); }
      if(typeof body.rosterComplete!=="boolean") throw new HttpError("Confirm whether the entire Everfit roster was enumerated.",400);
      const saved=await db.from("everfit_inbox_runs").insert({actor:access.email,plan,roster_complete:body.rosterComplete}).select("id").single();
      if(saved.error) throw saved.error;
      return reply({runId:saved.data.id});
    }
    if(typeof body.runId!=="string" || !/^[a-f0-9-]{36}$/.test(body.runId)) throw new HttpError("Invalid sync ID.",400);
    if(body.action==="resume") {
      const resumed=await db.from("everfit_inbox_runs").update({status:"running",finished_at:null}).eq("id",body.runId).eq("actor",access.email).eq("status","partial").select("id").maybeSingle();
      if(resumed.error) throw resumed.error;
      if(!resumed.data) throw new HttpError("Only your partial sync can be resumed.",409);
      return reply({runId:resumed.data.id,resumed:true});
    }
    if(body.action==="finish") {
      const result=await db.rpc("finish_everfit_inbox",{p_run:body.runId,p_actor:access.email});
      if(result.error) throw result.error;
      return reply(result.data);
    }
    if(body.action!=="capture" && body.action!=="batch") throw new HttpError("Unknown inbox action.",400);
    let captures;
    try { captures=body.action==="batch" ? parseInboxBatch(body.captures) : [parseInboxCapture(body.capture)]; }
    catch(e) { throw new HttpError((e as Error).message,400); }
    // Read the roster once for the whole batch; normalized duplicate emails stay unlinked.
    const byEmail=new Map<string,number[]>();
    for(let offset=0; ; offset+=1000) {
      const page=await db.from("clients").select("id,email").order("id").range(offset,offset+999);
      if(page.error) throw page.error;
      for(const client of page.data) {
        const email=client.email?.trim().toLowerCase();
        if(email) byEmail.set(email,[...(byEmail.get(email)??[]),client.id]);
      }
      if(page.data.length<1000) break;
    }
    const items=captures.map(capture=>{
      const matches=capture.email ? byEmail.get(capture.email)??[] : [];
      return {capture,coach:everfitCoach(capture.owner),client:matches.length===1?matches[0]:null};
    });
    if(body.action==="batch") {
      const saved=await db.rpc("capture_everfit_inbox_batch",{p_run:body.runId,p_actor:access.email,p_items:items});
      if(saved.error) throw saved.error;
      return reply(saved.data);
    }
    const item=items[0];
    const saved=await db.rpc("capture_everfit_inbox",{p_run:body.runId,p_actor:access.email,p_capture:item.capture,p_coach:item.coach,p_client:item.client});
    if(saved.error) throw saved.error;
    return reply(saved.data);
  } catch(error) { return fail(error); }
}
