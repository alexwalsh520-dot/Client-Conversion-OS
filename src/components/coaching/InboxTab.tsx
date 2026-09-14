"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw, Upload } from "lucide-react";
import type { InboxConversation, InboxMessage } from "@/lib/inbox/types";
async function read(url: string, init?: RequestInit) {
  const response = await fetch(url, {cache:"no-store",...init});
  const body = await response.json();
  if(!response.ok) throw new Error(body.error || "Inbox request failed.");
  return body;
}
export default function InboxTab() {
  const [conversations,setConversations]=useState<InboxConversation[]>([]);
  const [selected,setSelected]=useState<InboxConversation|null>(null);
  const [messages,setMessages]=useState<InboxMessage[]>([]);
  const [before,setBefore]=useState<string|null>(null);
  const [coach,setCoach]=useState("");
  const [search,setSearch]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [admin,setAdmin]=useState(false);
  const version=useRef(0);
  const load=useCallback(async()=>{
    setBusy(true);setError("");
    try {
      const all: InboxConversation[]=[];let offset: number|null=0;
      while(offset!==null) {
        const page=await read(`/api/coaching/inbox?offset=${offset}`);
        all.push(...page.conversations);offset=page.nextOffset;setAdmin(page.admin);
      }
      setConversations(all);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  async function open(conversation: InboxConversation, older=false) {
    const requestVersion=++version.current;
    if(!older) {setSelected(conversation);setMessages([]);setBefore(null);}
    setError("");
    try {
      const page=await read(`/api/coaching/inbox?id=${encodeURIComponent(conversation.everfit_id)}${older&&before?`&before=${encodeURIComponent(before)}`:""}`);
      if(version.current!==requestVersion) return;
      setMessages(old=>older?[...page.messages,...old]:page.messages);setBefore(page.before);setSelected(page.conversation);
    } catch(e) {if(version.current===requestVersion)setError((e as Error).message);}
  }
  async function importFile(file: File) {
    setBusy(true);setError("");setNotice("");
    try {
      if(file.size>2000000) throw new Error("Import exceeds 2 MB. Split captures into smaller files.");
      const response=await read("/api/coaching/inbox",{method:"POST",headers:{"Content-Type":"application/json"},body:await file.text()});
      setNotice(response.runId?`Sync started. Run ID: ${response.runId}`:response.status?`Sync ${response.status}: ${response.complete}/${response.total} conversations verified.`:response.complete?"Messages saved; conversation coverage verified.":"Messages saved; more history or boundary verification is needed.");
      await load();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const coaches=[...new Set(conversations.map(c=>c.coach_name).filter((c):c is string=>!!c))].sort();
  const filtered=conversations.filter(c=>(!coach||c.coach_name===coach)&&`${c.name} ${c.owner}`.toLowerCase().includes(search.toLowerCase()));
  return <section aria-label="Everfit inbox" style={{display:"grid",gap:16}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <div><h2 style={{fontSize:22,fontWeight:650}}>Inbox</h2><p style={{color:"var(--text-secondary)",fontSize:13}}>Everfit conversations · {conversations.length} stored · Read only</p></div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {admin&&<label className="btn btn-secondary" style={{cursor:busy?"wait":"pointer"}}><Upload size={14}/> Import sync JSON<input aria-label="Import inbox sync JSON" type="file" accept="application/json,.json" disabled={busy} style={{display:"none"}} onChange={e=>{const file=e.target.files?.[0];if(file)void importFile(file);e.target.value="";}}/></label>}
        <button className="btn btn-secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={14}/> Refresh stored inbox</button>
      </div>
    </div>
    <p style={{fontSize:12,color:"var(--text-secondary)"}}>Ask Codex to sync Everfit to collect new messages. Refresh reloads saved data. Each conversation shows its own verified coverage.</p>
    {error&&<div role="alert" style={{padding:14,border:"1px solid var(--danger)",borderRadius:10}}>{error}</div>}
    {notice&&<div role="status" style={{padding:12}}>{notice}</div>}
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <input aria-label="Search conversations" placeholder="Search clients or Everfit coaches…" value={search} onChange={e=>setSearch(e.target.value)} className="form-input" style={{flex:1,minWidth:220}}/>
      <select aria-label="Filter by coach" value={coach} onChange={e=>{setCoach(e.target.value);setSelected(null);setMessages([]);version.current++;}} className="form-input"><option value="">All accessible coaches</option>{coaches.map(c=><option key={c}>{c}</option>)}</select>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 310px), 1fr))",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",minHeight:420}}>
      <div style={{maxHeight:650,overflowY:"auto",borderRight:"1px solid var(--border)"}}>
        {!busy&&!filtered.length&&<div style={{padding:28,color:"var(--text-secondary)"}}><MessageSquare size={24}/><p>{conversations.length?"No matching conversations.":error?"Waiting for inbox storage.":"No conversations imported yet. Start the first Everfit sync to populate this inbox."}</p></div>}
        {busy&&<p role="status" style={{padding:16}}>Loading inbox…</p>}
        {filtered.map(c=><button key={c.everfit_id} onClick={()=>void open(c)} aria-pressed={selected?.everfit_id===c.everfit_id} style={{display:"block",width:"100%",padding:16,textAlign:"left",borderBottom:"1px solid var(--border)",background:selected?.everfit_id===c.everfit_id?"var(--accent-soft)":"transparent"}}><strong>{c.name}</strong><div style={{fontSize:12,color:"var(--text-secondary)",marginTop:5}}>{c.coach_name||c.owner} · {c.message_count} messages</div><div style={{fontSize:11,marginTop:5}}>{c.synced_through?`Verified ${new Date(c.synced_through).toLocaleString()}`:"Coverage not verified"}{!c.history_complete?" · History incomplete":""}</div></button>)}
      </div>
      <div style={{padding:20,maxHeight:650,overflowY:"auto"}}>
        {!selected?<div style={{padding:36,color:"var(--text-secondary)"}}>Select a conversation to read its saved messages.</div>:<>
          <h3 style={{fontWeight:650}}>{selected.name}</h3><p style={{fontSize:12,color:"var(--text-secondary)",marginBottom:20}}>{selected.owner} · {selected.client_id===null?"CCOS client link needs review":"Linked to CCOS client"}<br/>Dates are preserved as displayed in Everfit. Attachments are indicated, not downloaded.</p>
          {before&&<button className="btn btn-secondary" onClick={()=>void open(selected,true)}>Load older messages</button>}
          {messages.map(m=><article key={m.message_id} style={{padding:12,margin:"12px 0",borderRadius:10,border:"1px solid var(--border)",marginLeft:m.sender==="coach"?24:0,marginRight:m.sender==="client"?24:0}}><div style={{fontSize:11,color:"var(--text-secondary)",marginBottom:6}}>{m.sender} · {m.date} {m.time}</div><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:13}}>{m.text}</p>{m.attachments&&<p style={{fontSize:12,color:"var(--text-secondary)"}}>Attachment present in Everfit</p>}</article>)}
        </>}
      </div>
    </div>
  </section>;
}
