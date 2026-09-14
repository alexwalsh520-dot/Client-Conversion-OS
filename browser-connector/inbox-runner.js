const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let workerId;
const job=async()=>(await chrome.storage.session.get('inboxJob')).inboxJob;
async function update(values){const next={...await job(),...values};await chrome.storage.session.set({inboxJob:next});document.querySelector('#message').textContent=next.message||'';document.querySelector('#progress').max=next.total||1;document.querySelector('#progress').value=next.done||0;document.querySelector('#counts').textContent=`${next.done||0} / ${next.total||0} clients saved`;} 
document.querySelector('#cancel').addEventListener('click',()=>update({cancelRequested:true}));
async function api(body){const s=await job();const r=await chrome.tabs.sendMessage(s.ccosTab,{type:'CCOS_INBOX_API',body});if(!r?.ok)throw Error(r?.error||'Keep CCOS open and signed in.');return r;}
async function read(action,client){const r=await chrome.tabs.sendMessage(workerId,{type:'EVERFIT_READ',action,client});if(!r?.ok)throw Error(r?.error||'Everfit unavailable.');return r;}
async function navigate(url){await chrome.tabs.update(workerId,{url});for(let i=0;i<50;i++){await sleep(500);const t=await chrome.tabs.get(workerId);if(t.status==='complete'&&t.url?.startsWith(url)){try{await read('ping');return;}catch{}}}throw Error('Sign into Everfit, then resume.');}
async function main(){
  await api({action:'preflight'});await update({status:'running',message:'Discovering every team client…'});
  workerId=(await chrome.tabs.create({url:'https://app.everfit.io/home/client',active:false})).id;
  await navigate('https://app.everfit.io/home/client');
  let state=await job(),runId=state.runId;
  if(!runId){const {plan}=await read('roster');runId=(await api({action:'start',rosterComplete:true,plan})).runId;await update({runId});}
  const status=await api({action:'status',runId});
  if(status.run.status==='partial')await api({action:'resume',runId});
  const saved=new Set(status.items.map(i=>i.everfit_id));let done=saved.size,failed=0,pending=[];
  const plan=status.run.plan;await update({done,total:plan.length,failed});
  async function flush(){if(!pending.length)return;const result=await api({action:'batch',runId,captures:pending});done+=result.saved;failed+=result.failed.length;pending=[];await update({done,failed});}
  await navigate('https://app.everfit.io/home/inbox');
  for(const client of plan){
    if((await job()).cancelRequested){await flush();await api({action:'finish',runId});await update({status:'interrupted',message:'Stopped. Press Sync to resume.'});return;}
    if(saved.has(client.id))continue;
    await update({message:`${client.owner} · ${client.name}`});
    try{
      const checkpoint=status.checkpoints.find(c=>c.everfit_id===client.id)?.checkpoint_id;
      const capture=await read('inbox',{...client,checkpoint});
      const next={...capture,id:client.id,owner:client.owner,capturedAt:new Date().toISOString()};
      if(new TextEncoder().encode(JSON.stringify(next)).length>2700000)throw Error('History exceeds one batch; this client needs chunked backfill.');
      if(new TextEncoder().encode(JSON.stringify([...pending,next])).length>2700000)await flush();
      pending.push(next);if(pending.length>=10)await flush();
    }catch(e){failed++;await update({failed,message:`${client.name}: ${e.message}`});}
  }
  await flush();const final=await api({action:'finish',runId});
  await update({status:failed?'interrupted':final.status,message:failed?`${failed} clients need retry. Press Sync to resume.`:final.status==='completed'?'All team conversations and activity synced.':'Messages saved; some older history remains incomplete.',done,failed});
}
main().catch(e=>update({status:'interrupted',message:e.message})).finally(async()=>{if(workerId)await chrome.tabs.remove(workerId).catch(()=>{});});
