"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageSquare, Search } from "lucide-react";
import styles from "./inbox.module.css";
import type { InboxConversation, InboxMessage } from "@/lib/inbox/types";
async function read(url: string, init?: RequestInit) {
  const response = await fetch(url, {cache:"no-store",...init});
  const body = await response.json();
  if(!response.ok) throw new Error(body.error || "Inbox request failed.");
  return body;
}
function messageDate(message: InboxMessage) {
  if (message.observed_at && /^(Today|Yesterday)$/.test(message.date)) {
    const date = new Date(message.observed_at);
    if(message.date === "Yesterday")date.setDate(date.getDate()-1);
    return date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
  }
  return message.date || "Date unavailable";
}
export default function InboxTab() {
  const [conversations,setConversations]=useState<InboxConversation[]>([]);
  const [selected,setSelected]=useState<InboxConversation|null>(null);
  const [messages,setMessages]=useState<InboxMessage[]>([]);
  const [before,setBefore]=useState<string|null>(null);
  const [coach,setCoach]=useState("");
  const [search,setSearch]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const version=useRef(0);
  const load=useCallback(async()=>{
    setBusy(true);setError("");
    try {
      const all: InboxConversation[]=[];let offset: number|null=0;
      while(offset!==null) {
        const page=await read(`/api/coaching/inbox?offset=${offset}`);
        all.push(...page.conversations);offset=page.nextOffset;
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
      if(!older)requestAnimationFrame(()=>bottom.current?.scrollIntoView({block:"nearest"}));
    } catch(e) {if(version.current===requestVersion)setError((e as Error).message);}
  }
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(()=>{bottom.current?.scrollIntoView({block:"nearest"});},[selected?.everfit_id]);
  const coaches=[...new Set(conversations.map(c=>c.coach_name).filter((c):c is string=>!!c))].sort();
  const filtered=conversations.filter(c=>(!coach||c.coach_name===coach)&&`${c.name} ${c.owner}`.toLowerCase().includes(search.toLowerCase()));
  return <section aria-label="Inbox" className={`${styles.inbox} ${selected ? styles.hasSelection : ""}`}>
    <aside className={styles.sidebar}>
      <header className={styles.sidebarHeader}>
        <h2>Inbox</h2>
        <select aria-label="Filter by coach" value={coach} onChange={e=>{setCoach(e.target.value);setSelected(null);setMessages([]);version.current++;}}>
          <option value="">All coaches</option>{coaches.map(c=><option key={c}>{c}</option>)}
        </select>
      </header>
      <label className={styles.search}><Search size={15}/><input aria-label="Search conversations" placeholder="Search" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      {error&&<p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.conversations}>
        {busy&&<p className={styles.empty} role="status">Loading…</p>}
        {!busy&&!filtered.length&&<p className={styles.empty}>{search||coach?"No matches":"No conversations yet"}</p>}
        {filtered.map(c=><button key={c.everfit_id} onClick={()=>void open(c)} aria-pressed={selected?.everfit_id===c.everfit_id} className={styles.conversation}>
          <span className={styles.avatar}>{c.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</span>
          <span className={styles.conversationText}><span className={styles.row}><strong>{c.name}</strong></span><span className={styles.preview}>{c.coach_name||c.owner}</span></span>
        </button>)}
      </div>
    </aside>
    <div className={styles.chat}>
      {!selected?<div className={styles.blank}><MessageSquare size={28} strokeWidth={1.3}/><p>Select a conversation</p></div>:<>
        <header className={styles.chatHeader}><button aria-label="Back to conversations" className={styles.back} onClick={()=>{setSelected(null);version.current++;}}><ArrowLeft size={18}/></button><div><h3>{selected.name}</h3><span>{selected.coach_name||selected.owner}</span></div></header>
        <div className={styles.messages}>
          {before&&<button className={styles.older} onClick={()=>void open(selected,true)}>Earlier messages</button>}
          {messages.map((m,i)=><div key={m.message_id}>
            {(i===0||messageDate(messages[i-1])!==messageDate(m))&&<div className={styles.date}>{messageDate(m)}</div>}
            <article className={`${styles.bubble} ${m.sender==="coach"?styles.outgoing:styles.incoming}`}>
              {m.text&&<p>{m.text}</p>}{m.attachments&&<span className={styles.attachment}>Attachment</span>}
              <time>{m.time}</time>
            </article>
          </div>)}
          <div ref={bottom}/>
        </div>
      </>}
    </div>
  </section>;
}
