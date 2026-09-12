const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
async function run({failClient=false,resume=false,stop=false}={}){
 let state={ccosTab:1,status:'starting',runId:resume?'run-1':null,cancelRequested:false};
 const plan=['a','b'].map(c=>({id:c.repeat(24),name:'Client '+c,owner:'Coach Example'}));
 const saved=new Set(resume?[plan[0].id]:[]),calls=[];
 let resolve;const finished=new Promise(r=>resolve=r);
 const elements=new Map();const document={querySelector:s=>{if(!elements.has(s)) elements.set(s,{addEventListener(){}});return elements.get(s);}};
 let url='';
 const chrome={storage:{session:{get:async()=>({job:{...state}}),set:async v=>{state=v.job;if(['completed','partial','interrupted'].includes(state.status)) resolve();}}},tabs:{
  create:async()=>({id:2}),update:async(id,options)=>{url=options.url;},get:async()=>({status:'complete',url}),remove:async()=>{},
  sendMessage:async(id,msg)=>{
   calls.push(msg);
   if(id===1){const b=msg.body;
    if(b.action==='preflight'||b.action==='resume') return {ok:true};
    if(b.action==='start') return {ok:true,runId:'run-1'};
    if(b.action==='status') return {ok:true,plan,items:[...saved].map(everfit_id=>({everfit_id,status:'completed'}))};
    if(b.action==='capture'){saved.add(b.capture.id);if(stop) state.cancelRequested=true;return {ok:true};}
    if(b.action==='failure') return {ok:true};
    if(b.action==='finish') return {ok:true,status:saved.size===2?'completed':'partial',saved:saved.size,total:2};
    throw new Error('Unexpected API action');
   }
   if(msg.action==='ping') return {ok:true};
   if(msg.action==='roster') return {ok:true,plan};
   if(failClient&&msg.client.id===plan[1].id) return {error:'Coach identity cannot be verified'};
   if(msg.action==='profile') return {ok:true,email:'client@example.test',owner:'Coach Example',updates:[],notes:[]};
   if(msg.action==='conversation') return {ok:true,messages:[{id:'message',text:'Example'}],notes:[],historyComplete:true};
   throw new Error('Unexpected reader action');
  }
 }};
 vm.runInNewContext(readFileSync(__dirname+'/runner.js','utf8'),{chrome,document,Date,setTimeout:fn=>queueMicrotask(fn)});
 await finished;return {state,calls,saved};
}
test('one start collects, summarizes and saves all clients before announcing completion',async()=>{
 const r=await run();assert.equal(r.saved.size,2);assert.equal(r.state.status,'completed');assert.equal(r.calls.filter(c=>c.body?.action==='capture').length,2);
});
test('unverified client capture is visibly partial and never submitted as empty evidence',async()=>{
 const r=await run({failClient:true});assert.equal(r.state.status,'partial');assert.equal(r.saved.size,1);assert.equal(r.state.failed,1);assert.equal(r.calls.filter(c=>c.body?.action==='failure').length,1);
});
test('resuming skips already saved clients',async()=>{
 const r=await run({resume:true});assert.equal(r.state.status,'completed');assert.equal(r.calls.filter(c=>c.body?.action==='capture').length,1);
});
test('stop saves a partial report and does not falsely announce a full sync',async()=>{
 const r=await run({stop:true});assert.equal(r.state.status,'partial');assert.equal(r.saved.size,1);assert.equal(r.calls.filter(c=>c.body?.action==='finish').length,1);
});
