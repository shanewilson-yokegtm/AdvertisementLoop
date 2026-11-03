import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url),cache=new Map();
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);new Function('require','module','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>{if(!id.startsWith('.'))return require(id);const target=path.resolve(path.dirname(file),id);return load(existsSync(target+'.ts')?target+'.ts':target);},m,m.exports);return m.exports;}
const model=load('src/lib/performance/model.ts');const {graphReader,loadMetaPerformance,enrichCreativeImages}=load('src/lib/server/meta-reporting.ts');
const config={token:'secret-never-in-url',accountId:'123',version:'v26.0'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const period={from:'2026-09-01',to:'2026-09-02'};
const adRow={ad_id:'1',ad_name:'YOKE | Proof | v1',adset_id:'10',campaign_id:'20',campaign_name:'Campaign',date_start:period.from,date_stop:period.to,spend:'12',impressions:'100',reach:'80',inline_link_clicks:'5',actions:[{action_type:'view_content',value:'2'},{action_type:'offsite_conversion.fb_pixel_view_content',value:'2'}]};
function fixture(){return {account:{id:'act_123',name:'Account',currency:'CAD',timezone_name:'America/Vancouver'},range:period,previousRange:model.previousRange(period),fetchedAt:'2026-09-03T12:00:00Z',warnings:[],campaigns:[{id:'20',name:'Campaign',effective_status:'ACTIVE'},{id:'21',name:'No delivery',effective_status:'PAUSED'}],adsets:[],ads:[{id:'1',name:adRow.ad_name,campaign_id:'20',adset_id:'10',effective_status:'ACTIVE',creative:{id:'30'}},{id:'2',name:'Unmapped',campaign_id:'20',adset_id:'10',effective_status:'PAUSED',creative:{id:'31'}}],current:[adRow],daily:[{...adRow,date_stop:period.from}],accountTotal:adRow,campaignTotals:[{...adRow,reach:'73'}],previous:null,platforms:[],campaignId:null,source:'meta'};}

test('action aliases overlap: website action wins without double counting',()=>{
 assert.equal(model.resultCount(adRow.actions,'view_content'),2);assert.equal(model.resultCount([{action_type:'lead',value:'8'},{action_type:'offsite_conversion.fb_pixel_lead',value:'3'}],'lead'),3);assert.equal(model.resultCount(undefined,'purchase'),0);
});
test('reach and rates retain their actual grain and zero denominators',()=>{
 assert.equal(model.metrics([adRow,adRow],'view_content').reach,null);assert.equal(model.metrics([adRow,adRow],'view_content',91).reach,91);assert.equal(model.ratio(12,0),null);assert.equal(model.change(4,0),null);assert.equal(model.groups(fixture(),'campaign','view_content')[0].metrics.reach,73);
});
test('complete-day presets and equal previous periods cross leap years/months',()=>{
 assert.deepEqual(model.presetRange('7','2024-03-01'),{from:'2024-02-23',to:'2024-02-29'});assert.deepEqual(model.previousRange({from:'2024-03-01',to:'2024-03-07'}),{from:'2024-02-23',to:'2024-02-29'});assert.deepEqual(model.presetRange('mtd','2026-11-01'),{from:'2026-11-01',to:'2026-11-01'});assert.deepEqual(model.presetRange('mtd','2026-11-02'),{from:'2026-11-01',to:'2026-11-01'});
 assert.equal(model.dateInZone(new Date('2026-11-02T01:00:00Z'),'America/Vancouver'),'2026-11-01');
});
test('range validation rejects calendar errors, future dates and unbounded queries',()=>{
 for(const p of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-09-02',to:'2026-09-01'},{from:'2026-09-01',to:'2099-01-01'},{from:'2026-01-01',to:'2026-09-01'}])assert.throws(()=>model.validateRange(p,'2026-10-01'));assert.deepEqual(model.validateRange(period,'2026-10-01'),period);
});
test('concepts are provisional, unclassified stays visible and IDs preserve separate objects',()=>{
 const d=fixture();d.current.push({...adRow,ad_id:'2',ad_name:'Unmapped',spend:'3'});const c=model.groups(d,'concept','view_content');assert.equal(c.find(c=>c.id==='Proof').metrics.spend,12);assert.equal(c.find(c=>c.id==='__unclassified').metrics.spend,3);assert.equal(model.groups(d,'campaign','view_content').length,2);
});
test('creative inventory includes zero-delivery ads; shared creatives are grouped and mixed statuses explicit',()=>{
 const d=fixture();assert.equal(model.groups(d,'creative','view_content').length,2);d.ads[1].creative.id='30';const r=model.groups(d,'creative','view_content');assert.equal(r.length,1);assert.equal(r[0].status,'MIXED');assert.deepEqual(r[0].adIds,['1','2']);assert.equal(r[0].metrics.spend,12);
});
test('daily zero fill occurs only within successful queried range',()=>{
 const d=model.dailySeries(fixture(),'view_content');assert.equal(d.length,2);assert.equal(d[0].results,2);assert.equal(d[1].spend,0);
});
test('preview and destination URLs reject unsafe schemes and misleading hosts',()=>{
 for(const u of ['javascript:alert(1)','https://fbcdn.net.evil.test/a','http://scontent.xx.fbcdn.net/a'])assert.equal(model.safeMediaUrl(u),undefined);assert.equal(model.safeMediaUrl('https://scontent.xx.fbcdn.net/a'),'https://scontent.xx.fbcdn.net/a');const a={creative:{object_story_spec:{link_data:{link:'javascript:alert(1)'}}}};assert.equal(model.destination(a),null);
});
test('CSV escapes formulas including whitespace-prefixed payloads and quotes',()=>{
 for(const value of ['=SUM(1,2)','  =HYPERLINK("x")','+cmd','-cmd','@SUM(1)','\tvalue'])assert.ok(model.csvCell(value).startsWith('"\''));assert.equal(model.csvCell('Normal "copy"'),'"Normal ""copy"""');assert.equal(model.csvCell(null),'""');
});
test('ad-set and concept inventory is inspectable without delivery, with current ads attached',()=>{
 const d=fixture();d.adsets=[{id:'10',name:'One',campaign_id:'20'},{id:'11',name:'No delivery',campaign_id:'20'}];d.ads.push({id:'3',name:'YOKE | New concept | v1',campaign_id:'20',adset_id:'11',effective_status:'PAUSED'});const sets=model.groups(d,'adset','view_content');assert.equal(sets.length,2);assert.equal(sets.find(s=>s.id==='11').metrics.spend,0);assert.deepEqual(sets.find(s=>s.id==='11').adIds,['3']);assert.ok(model.groups(d,'concept','view_content').some(c=>c.id==='New concept'));assert.equal(model.groups(d,'campaign','view_content').find(c=>c.id==='20').adIds.length,3);
});
test('placement creatives resolve declared hashes to full-resolution account assets and copy',async()=>{
 const ads=[{id:'1',creative:{id:'c',thumbnail_url:'https://scontent.xx.fbcdn.net/tiny',asset_feed_spec:{images:[{hash:'a'},{hash:'b'},{hash:'a'}],bodies:[{text:'Actual copy'}],titles:[{text:'Actual headline'}],link_urls:[{website_url:'https://example.com/waitlist'}]}}}];let calls=0;
 await enrichCreativeImages(ads,'act_123',{pages:async(path,q)=>{calls++;assert.equal(path,'act_123/adimages');assert.deepEqual(JSON.parse(q.hashes),['a','b']);return[{hash:'a',url:'https://scontent.xx.fbcdn.net/full',width:1080,height:1080},{hash:'b',url:'https://evil.test/not-meta',width:1080,height:1920}];}});
 assert.equal(calls,1);assert.equal(ads[0].creative.image_url,'https://scontent.xx.fbcdn.net/full');assert.equal(ads[0].creative.images.length,1);assert.equal(ads[0].creative.body,'Actual copy');assert.equal(model.destination(ads[0]),'https://example.com/waitlist');
});
test('image lookups batch unique hashes and preserve existing static image URLs',async()=>{
 const ads=[{id:'1',creative:{id:'c',image_url:'https://scontent.xx.fbcdn.net/existing',asset_feed_spec:{images:Array.from({length:151},(_,n)=>({hash:String(n)}))}}}];let batches=0,maxBatch=0;
 await enrichCreativeImages(ads,'act_123',{pages:async(path,q)=>{batches++;const hashes=JSON.parse(q.hashes);maxBatch=Math.max(maxBatch,hashes.length);return hashes.map(hash=>({hash,url:'https://scontent.xx.fbcdn.net/'+hash,width:1080,height:1080}));}});
 assert.equal(batches,3);assert.equal(maxBatch,75);assert.equal(ads[0].creative.images.length,151);assert.equal(ads[0].creative.image_url,'https://scontent.xx.fbcdn.net/existing');
});
test('pagination stays on the same account/query with header auth; ignores malicious next URLs',async()=>{
 const calls=[];const reader=graphReader(config,async(u,o)=>{calls.push({url:new URL(u),options:o});return calls.length===1?json({data:[1],paging:{next:'https://evil.test/?access_token=leak',cursors:{after:'cursor2'}}}):json({data:[2]});});assert.deepEqual(await reader.pages('act_123/ads',{fields:'id'}),[1,2]);assert.equal(calls[1].url.hostname,'graph.facebook.com');assert.equal(calls[1].url.searchParams.get('after'),'cursor2');assert.equal(calls[1].url.searchParams.get('fields'),'id');for(const c of calls){assert.equal(c.options.method,'GET');assert.equal(c.options.headers.Authorization,'Bearer secret-never-in-url');assert.ok(!c.url.href.includes(config.token));assert.equal(c.options.cache,'no-store');}
});
test('incomplete or looping collections fail instead of returning partial metrics',async()=>{
 for(const paging of [{next:'x'},{next:'x',cursors:{after:'same'}}]){const reader=graphReader(config,async()=>json({data:[1],paging}));await assert.rejects(reader.pages('act_123/ads'),e=>e.code==='incomplete');}
});
test('provider errors cannot echo credentials into dashboard responses',async()=>{
 const reader=graphReader(config,async()=>json({error:{code:190,message:`token=${config.token}`}},400));await assert.rejects(reader.get('act_123'),e=>e.code==='token_expired'&&!e.message.includes(config.token));
});
test('rate limiting and permission errors are actionable without raw provider messages',async()=>{
 for(const [code,expected]of [[4,'rate_limited'],[200,'permission']])await assert.rejects(graphReader(config,async()=>json({error:{code,message:config.token}},400)).get('act_123'),e=>e.code===expected&&!e.message.includes(config.token));
});
function fakeProvider(fail){return async u=>{const url=new URL(u),q=url.searchParams;if(url.pathname.endsWith('/act_123'))return json({id:'act_123',name:'Account',currency:'CAD',timezone_name:'America/Vancouver'});if(fail?.(url))return json({error:{code:100,message:'unsupported'}},400);if(url.pathname.endsWith('/insights'))return json({data:q.get('level')==='account'?[{...adRow,reach:'91'}]:[adRow]});return json({data:[]});};}
test('full report preserves historical delivery when current creative lookup is empty',async()=>{
 const d=await loadMetaPerformance(config,period,null,fakeProvider());assert.equal(d.ads[0].id,'1');assert.equal(d.accountTotal.reach,'91');assert.equal(d.daily.length,1);assert.equal(d.warnings.length,0);
});
test('optional metadata failure is visible while required trend failure rejects the report',async()=>{
 const d=await loadMetaPerformance(config,period,null,fakeProvider(u=>u.pathname.endsWith('/ads')));assert.ok(d.warnings.some(w=>w.includes('creative previews unavailable')));assert.equal(d.ads[0].id,'1');await assert.rejects(loadMetaPerformance(config,period,null,fakeProvider(u=>u.searchParams.has('time_increment'))),e=>e.code==='provider');
});
test('campaign filter is applied to every insight period and client cannot submit a path',async()=>{
 const urls=[];const fake=fakeProvider();await loadMetaPerformance(config,period,'20',async(u,o)=>{urls.push(new URL(u));return fake(u,o);});const insights=urls.filter(u=>u.pathname.endsWith('/insights'));assert.equal(insights.length,6);for(const u of insights)assert.deepEqual(JSON.parse(u.searchParams.get('filtering')),[{field:'campaign.id',operator:'IN',value:['20']}]);await assert.rejects(loadMetaPerformance(config,period,'../evil',fake),e=>e.status===400);
});
