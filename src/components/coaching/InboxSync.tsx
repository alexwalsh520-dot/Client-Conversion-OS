"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
type Job={status:string;done:number;total:number;message:string;runId?:string;failed?:number};
type Reply={connected?:boolean;error?:string;job?:Job|null};
function command(command:string):Promise<Reply>{return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();
  const timer=setTimeout(()=>{window.removeEventListener("message",receive);reject(new Error("Connect the Everfit browser reader to sync."));},3500);
  function receive(e:MessageEvent){if(e.source!==window||e.origin!==location.origin||e.data?.channel!=="ccos-everfit-response"||e.data.id!==id)return;clearTimeout(timer);window.removeEventListener("message",receive);if(e.data.value?.error)reject(new Error(e.data.value.error));else resolve(e.data.value);}
  window.addEventListener("message",receive);window.postMessage({channel:"ccos-everfit-request",id,command},location.origin);
});}
export default function InboxSync({onSaved,admin}:{onSaved:()=>void;admin:boolean}){
  const [job,setJob]=useState<Job|null>(null),[starting,setStarting]=useState(false),[error,setError]=useState("");
  const last=useRef("");
  const refresh=useCallback(async()=>{try{const r=await command("INBOX_STATUS");setJob(r.job??null);const key=`${r.job?.runId}:${r.job?.done}`;if(r.job&&key!==last.current){last.current=key;onSaved();}}catch{/* Setup is shown only when Sync is pressed. */}},[onSaved]);
  useEffect(()=>{if(!admin)return;void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[refresh,admin]);
  const busy=starting||job?.status==="running"||job?.status==="starting";
  return <div style={{padding:"0 14px 12px",fontSize:12}}>
    {admin&&<button className="btn btn-secondary" disabled={busy} onClick={async()=>{setStarting(true);setError("");try{await command("INBOX_START");await refresh();}catch(e){setError((e as Error).message);}finally{setStarting(false);}}}><RefreshCw size={13}/>{busy?"Syncing…":"Sync all coaches"}</button>}
    {job&&<p role="status" style={{marginTop:8,color:"var(--text-secondary)"}}>{job.total?`${job.done} / ${job.total} clients · `:""}{job.message}</p>}
    {busy&&<button onClick={()=>void command("INBOX_CANCEL").then(refresh)} style={{marginTop:6}}>Stop</button>}
    {error&&<div role="alert" style={{marginTop:8}}><p>{error}</p><a href="/downloads/ccos-everfit-sync.zip" download>Download browser reader</a><p style={{marginTop:6}}>In Chrome, unzip it, open Extensions → Manage Extensions, enable Developer mode, then Load unpacked. Select the extracted folder and refresh CCOS. Keep Chrome signed into Everfit while syncing.</p></div>}
  </div>;
}
