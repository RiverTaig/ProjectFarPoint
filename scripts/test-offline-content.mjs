import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContentHandler,imageFormat} from '../supabase/functions/_shared/offlineContent.ts';
import {appendMissingImageReferences,validateImageDrafts,offlineContentRequest} from '../src/offline/offlineContentClient.ts';
const requestId='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
const activityId='33333333-3333-4333-8333-333333333333',pw='test-content-only';
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3]);
const file=()=>new File([png],'camp.png',{type:'image/png'});
function context(overrides={}) {
 const calls=[];let opened=0;
 const store={async activity(...args){calls.push(['activity',...args]);return{id:activityId,description:'Existing walk',images:[]};},
  async upload(...args){calls.push(['upload',...args]);},async save(...args){calls.push(['save',...args]);},...overrides};
 const handler=createContentHandler({config:()=>({password:pw,ownerId:owner}),allowedOrigins:()=>['https://projectfarpoint.com'],store:()=>{opened++;return store;}});
 const json=(body)=>handler(new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,pw,...body})}));
 const image=(extra={},selected=file())=>{
  const form=new FormData();for(const[k,v]of Object.entries({requestId,pw,action:'image',name:'camp',caption:'Campsite',...extra}))form.set(k,v);
  form.set('file',selected);return handler(new Request('https://example.invalid',{method:'POST',body:form}));
 };
 return{handler,json,image,calls,opened:()=>opened};
}
test('content requires explicit POST and shared password before database access',async()=>{
 const c=context();assert.equal((await c.handler(new Request('https://example.invalid'))).status,405);
 assert.equal((await c.json({action:'read',pw:'wrong'})).status,401);
 assert.equal((await c.image({pw:'wrong'})).status,401);assert.equal(c.opened(),0);
});
test('content origin validation, owner scoping and unknown request rejection',async()=>{
 const c=context();const denied=await c.handler(new Request('https://example.invalid',{method:'OPTIONS',headers:{origin:'https://other.invalid'}}));assert.equal(denied.status,403);
 const result=await c.json({action:'read',ownerId:'attacker'});assert.equal(result.status,200);
 assert.deepEqual(c.calls[0],['activity',requestId,owner]);
 const missing=context({async activity(){return null;}});assert.equal((await missing.json({action:'read'})).status,404);
 assert.equal(missing.calls.length,0);
});
test('description saves through owner-scoped RPC without changing hike geometry',async()=>{
 const c=context();const text='A day on the trail.\n\n{Image name="camp"}';
 assert.equal((await c.json({action:'description',description:text})).status,200);
 assert.deepEqual(c.calls[1],['save',requestId,owner,text,null]);
 assert.equal((await c.json({action:'description',description:'x'.repeat(20001)})).status,422);
});
test('image format uses bytes rather than extension or claimed MIME',()=>{
 assert.equal(imageFormat(png).mime,'image/png');
 assert.equal(imageFormat(new TextEncoder().encode('<svg onload="alert(1)">')),null);
});
test('image retries use deterministic content-addressed paths and never persist the password',async()=>{
 const c=context();assert.equal((await c.image()).status,200);assert.equal((await c.image()).status,200);
 const uploads=c.calls.filter(([type])=>type==='upload');assert.equal(uploads.length,2);assert.equal(uploads[0][1],uploads[1][1]);
 assert.match(uploads[0][1],new RegExp(`^${activityId}/offline/camp-[a-f0-9]{64}\\.png$`));
 const saved=c.calls.filter(([type])=>type==='save');assert.equal(saved[0][4].content_type,'image/png');assert.equal(saved[0][4].size_bytes,png.length);
 assert.ok(!JSON.stringify(c.calls).includes(pw));
});
test('image failures, invalid names, unsupported bytes and oversized files are readable',async()=>{
 const c=context();assert.equal((await c.image({name:'bad name'})).status,422);
 assert.equal((await c.image({},new File(['not a photo'],'fake.png',{type:'image/png'}))).status,422);
 assert.equal((await c.image({},new File([new Uint8Array(10485761)],'large.png',{type:'image/png'}))).status,422);
 const failed=context({async upload(){throw Error('internal secret must not leak');}});
 const response=await failed.image();assert.equal(response.status,500);assert.ok(!(await response.text()).includes('internal secret'));
 assert.equal(failed.calls.some(([type])=>type==='save'),false);
});
test('ten existing images block a new name before uploading',async()=>{
 const c=context({async activity(){return{id:activityId,description:'',images:Array.from({length:10},(_,i)=>({name:'p'+i,caption:'',url:'https://example.invalid/p.png'}))};}});
 assert.equal((await c.image()).status,422);assert.equal(c.calls.length,0);
});
test('new unreferenced images become a gallery, existing references are respected',()=>{
 assert.equal(appendMissingImageReferences('Walk',['camp','view']),'Walk\n\n{ImageCarousel images="camp,view"}');
 const text='{Image name="CAMP"}\n\n{ImageCarousel images="view, other"}';
 assert.equal(appendMissingImageReferences(text,['camp','view','other']),text);
 assert.equal(appendMissingImageReferences('',[]),'');
});
test('draft validation rejects duplicate names, unsupported files and excessive counts',()=>{
 const draft={id:'1',name:'camp',caption:'',file:file(),saved:false};validateImageDrafts([draft]);
 assert.throws(()=>validateImageDrafts([draft,{...draft,name:'CAMP'}]),/unique/);
 assert.throws(()=>validateImageDrafts([{...draft,file:new File(['x'],'image.heic',{type:'image/heic'})}]),/HEIC/);
 assert.throws(()=>validateImageDrafts(Array(11).fill(draft)),/10/);
});
test('browser upload sends multipart without overriding boundary or leaking password in URL',async()=>{
 const draft={id:'1',name:'camp',caption:'Campsite',file:file(),saved:false};
 await offlineContentRequest(requestId,pw,{type:'image',image:draft},{url:'https://example.supabase.co',anonKey:'public'},async(url,init)=>{
  assert.ok(url.endsWith('/functions/v1/offline-activity-content'));assert.ok(!url.includes(pw));assert.equal(init.referrerPolicy,'no-referrer');
  assert.ok(init.body instanceof FormData);assert.equal(init.body.get('pw'),pw);assert.equal(init.body.get('file').name,'camp.png');
  assert.equal(init.headers['Content-Type'],undefined);return Response.json({status:'content_saved'});
 });
});
