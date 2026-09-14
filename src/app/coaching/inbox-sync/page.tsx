"use client";
import { useState } from "react";
export default function InboxSyncPage() {
  const [payload,setPayload]=useState("");
  const [result,setResult]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit() {
    setBusy(true);
    try {
      const response=await fetch("/api/coaching/inbox",{method:"POST",headers:{"Content-Type":"application/json"},body:payload});
      setResult(JSON.stringify(await response.json()));
      if(response.ok)setPayload("");
    }catch{setResult('Request failed. Check sync status before retrying.');}
    finally{setBusy(false);}
  }
  return <main style={{maxWidth:720,margin:"48px auto",padding:24}}><h1>Inbox sync</h1><p>Codex batch transfer</p><textarea aria-label="Sync payload" value={payload} onChange={e=>setPayload(e.target.value)} rows={8} style={{width:"100%"}}/><button disabled={busy||!payload} onClick={()=>void submit()}>Submit batch</button><pre role="status" style={{whiteSpace:"pre-wrap"}}>{result}</pre></main>;
}
