import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseInboxCapture,parseInboxBatch} from './validation';
const valid=()=>({id:'a'.repeat(24),owner:'Coach',email:'CLIENT@example.com',capturedAt:new Date().toISOString(),messages:[{id:'native-message-1',sender:'client',date:'Today',time:'10:00 AM',text:'hello',attachments:false}],updates:[],notes:[],historyComplete:true,newestReached:true,historyStartReached:false});
test('weekly history flag cannot substitute for full-history evidence',()=>{
 const input=valid();
 assert.equal(parseInboxCapture(input).historyStartReached,false);
 assert.throws(()=>parseInboxCapture({...input,historyStartReached:undefined}));
 assert.throws(()=>parseInboxCapture({...input,newestReached:undefined}));
});
test('duplicate source messages and invalid senders are rejected',()=>{
 const input=valid();
 assert.throws(()=>parseInboxCapture({...input,messages:[input.messages[0],input.messages[0]]}));
 assert.throws(()=>parseInboxCapture({...input,messages:[{...input.messages[0],sender:'administrator'}]}));
});
test('canonical email and visible display dates are preserved',()=>{
 const parsed=parseInboxCapture(valid());
 assert.equal(parsed.email,'client@example.com');
 assert.equal(parsed.messages[0].date,'Today');
});

test('bulk capture accepts multiple clients but rejects duplicates and oversized batches',()=>{
 const first=valid(), second={...valid(),id:'b'.repeat(24)};
 assert.equal(parseInboxBatch([first,second]).length,2);
 assert.throws(()=>parseInboxBatch([first,first]));
 assert.throws(()=>parseInboxBatch([]));
 assert.throws(()=>parseInboxBatch(Array(51).fill(first)));
});
