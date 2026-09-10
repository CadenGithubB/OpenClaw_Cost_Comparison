import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseUsage, period, hardwareCost, priceUsage, summarize, resolveMapping, validateCatalog, compareCosts, contextSettings, MAX_IMPORT_BYTES} from '../src/core.mjs';
const catalog = JSON.parse(readFileSync(new URL('../data/pricing.json',import.meta.url)));
const row = (model='gemma4:31b',provider='ollama',totals={input:1000000,output:100000,totalTokens:1100000}) => ({model,provider,count:1,totals});
const parse = (rows,extra={}) => parseUsage(JSON.stringify({modelUsage:rows,...extra}));
const offer = {status:'verified',rates:{input:1,output:2,cacheRead:0.1,cacheWrite:1.25}};
const tiered = {...offer,maxStandardPrompt:272000,longContextMultipliers:{input:2,output:1.5,cacheRead:2,cacheWrite:2}};
const hardware={scenario:'buy',accounting:'depreciation',price:1200,months:12,share:100,electricity:false,watts:100,idleWatts:20,hours:8,rate:0.12};
test('catalog and synthetic demo validate',()=>{assert.equal(validateCatalog(catalog),catalog);assert.equal(parseUsage(readFileSync(new URL('../data/demo.json',import.meta.url),'utf8')).rows.length,3);});
test('recognizes requested Qwen 3.6 tag and keeps 3.5 separate',()=>{
  for(const tag of ['qwen3.6:35B','qwen3.6:35b','ollama/qwen3.6:35b'])assert.equal(resolveMapping(tag,catalog).id,'or-qwen36-35b');
  assert.equal(resolveMapping('qwen3.5:35b-a3b',catalog).id,'or-qwen35-35b');assert.equal(resolveMapping('qwen3.6:27b',catalog),null);
});
test('historical aliases remain recognizable but unpriced',()=>{const r=parse([row('deepseek-v3')]).rows[0];assert.equal(priceUsage(r,resolveMapping(r.model,catalog)).cost,null);});
test('flat and nested modelUsage produce the same tokens and cost',()=>{
  const nested=parse([row()]).rows[0],flat=parse([{model:'gemma4:31b',provider:'ollama',count:1,input:1000000,output:100000,totalTokens:1100000}]).rows[0];assert.deepEqual(nested,flat);assert.equal(priceUsage(flat,offer).cost,1.2);
});
test('prefers full aggregates over limited session rows',()=>{const result=parseUsage(JSON.stringify({aggregates:{byModel:[row()]},sessions:[{usage:{modelUsage:[row()]}}]}));assert.equal(result.rows[0].tokens,1100000);});
test('session imports distinguish providers and merge repeated same-provider rows',()=>{
  const result=parseUsage(JSON.stringify({sessions:[{usage:{modelUsage:[row('shared','local'),row('shared','cloud'),row('shared','local')]}}]}));assert.equal(result.rows.length,2);assert.equal(result.rows[0].tokens,2200000);assert.equal(result.rows[1].provider,'cloud');assert.equal(result.complete,false);
});
test('prototype-like names are safe literal keys',()=>{for(const name of ['__proto__','constructor','toString']){const r=parse([row(name)]).rows[0];assert.equal(r.model,name);assert.equal(resolveMapping(name,catalog),null);assert.equal(priceUsage(r,null).cost,null);}});
test('malicious names remain strings in normalized data',()=>{const model='<img src=x onerror=alert(1)>';assert.equal(parse([row(model)]).rows[0].model,model);});
test('cache buckets are disjoint and never dropped',()=>{
  const r=parse([row('cache','local',{input:1000000,output:100000,cacheRead:2000000,cacheWrite:400000,totalTokens:3500000})]).rows[0];assert.equal(r.tokens,3500000);assert.equal(priceUsage(r,offer).cost,1.9);assert.equal(priceUsage(r,offer,{cacheMode:'none'}).cost,3.6);assert.equal(priceUsage(r,{...offer,rates:{input:1,output:2}}).cost,null);
});
test('cache-only usage is retained and costed',()=>{const r=parse([row('cache','local',{input:0,output:0,cacheRead:1000000,totalTokens:1000000})]).rows[0];assert.equal(r.tokens,1000000);assert.equal(priceUsage(r,offer).cost,0.1);});
test('unknown price differs from valid zero',()=>{
  const r=parse([row()]).rows[0],free=priceUsage(r,{...offer,rates:{input:0,output:0}});assert.equal(free.cost,0);assert.equal(summarize([r],new Map([[r.key,free]])).complete,true);
  const unknown=summarize([r],new Map([[r.key,priceUsage(r,null)]]));assert.equal(unknown.cost,null);assert.equal(unknown.coverage,0);assert.equal(unknown.complete,false);
});
test('partial coverage cannot become a full total',()=>{const rows=parse([row('a'),row('b')]).rows;const sum=summarize(rows,new Map([[rows[0].key,{cost:1}],[rows[1].key,{cost:null}]]));assert.equal(sum.cost,1);assert.equal(sum.coverage,0.5);assert.equal(sum.complete,false);});
test('missing or inconsistent splits remain unpriced, including unquantified rows',()=>{for(const totals of [{totalTokens:1000},{input:100,totalTokens:100},{input:100,output:100,totalTokens:1000},{}]){const r=parse([row('unknown','local',totals)]).rows[0];assert.equal(r.complete,false);assert.equal(priceUsage(r,offer).cost,null);}});
test('invalid numeric values are rejected',()=>{for(const value of [-1,'100',1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>parse([row('bad','local',{input:value,output:0})]),/non-negative/);assert.throws(()=>parseUsage('{"modelUsage":[{"input":1e999,"output":0}]}'),/finite/);});
test('malformed shapes and oversized JSON fail helpfully',()=>{
  for(const value of ['null','[]','{"modelUsage":{}}','{"aggregates":[]}'])assert.throws(()=>parseUsage(value));assert.throws(()=>parseUsage(' '.repeat(MAX_IMPORT_BYTES+1)),/10 MB/);assert.throws(()=>parseUsage('{"daily":[],"totals":{}}'),/gateway usage-cost/);
});
test('dates include idle days and deduplicate activity dates',()=>{
  assert.equal(parse([row()],{startDate:'2026-09-01',endDate:'2026-09-30',daily:[{date:'2026-09-01'},{date:'2026-09-30'}]}).period.days,30);
  assert.equal(parse([row()],{daily:[{date:'2026-09-03'},{date:'2026-09-01'},{date:'2026-09-03'}]}).period.days,3);
  assert.equal(parse([row()]).period,null);assert.equal(period('2024-02-28','2024-03-01').days,3);assert.throws(()=>period('2026-02-30','2026-03-01'));assert.throws(()=>period('2026-09-02','2026-09-01'));
});
test('recorded zero is retained with estimate warning',()=>{const parsed=parse([row('a','local',{input:1,output:1,totalCost:0})]);assert.equal(parsed.rows[0].recordedCost,0);assert.ok(parsed.warnings.some(w=>w.includes('estimates')));});
test('mismatched totals and refreshing caches suppress conclusions',()=>{assert.equal(parse([row()],{totals:{totalTokens:9999999}}).complete,false);assert.equal(parse([row()],{cacheStatus:{state:'refreshing'}}).complete,false);assert.equal(parse([row()],{cacheStatus:{state:'ready',partial:false,stale:false}}).complete,true);});
test('unknown request sizes produce a full range rather than missing coverage',()=>{
  const r=parse([row()]).rows[0],price=priceUsage(r,tiered),sum=summarize([r],new Map([[r.key,price]]));
  assert.equal(price.cost,null);assert.equal(price.reason,null);assert.equal(price.lowCost,1.2);assert.equal(price.highCost,2.3);
  assert.equal(sum.complete,true);assert.equal(sum.coverage,1);assert.equal(sum.pricedTokens,1100000);assert.equal(sum.hasRange,true);
  assert.equal(priceUsage(r,tiered,{contextMode:'standard'}).cost,1.2);assert.equal(priceUsage(r,tiered,{contextMode:'long'}).cost,2.3);
});
test('270000-token limit resolves the tier but 276480 does not',()=>{
  const r=parse([row()]).rows[0];
  for(const contextLimit of [270000,272000]){const p=priceUsage(r,tiered,{contextMode:'limit',contextLimit});assert.equal(p.cost,1.2);assert.match(p.contextNote,/declared/);}
  for(const contextLimit of [272001,276480]){const p=priceUsage(r,tiered,{contextMode:'limit',contextLimit});assert.equal(p.hasRange,true);assert.equal(p.lowCost,1.2);assert.equal(p.highCost,2.3);}
});
test('aggregate input at or below the boundary stays standard even in the high scenario',()=>{
  for(const input of [0,270000,272000]){
    const r=parse([row('a','local',{input,output:400000})]).rows[0];
    for(const contextMode of ['range','long']){const p=priceUsage(r,tiered,{contextMode});assert.equal(p.hasRange,false);assert.equal(p.cost,priceUsage(r,offer).cost);}
  }
  const r=parse([row('a','local',{input:272001,output:0})]).rows[0];assert.equal(priceUsage(r,tiered).hasRange,true);
});
test('context envelope includes cache reads and writes and respects no-cache scenarios',()=>{
  const r=parse([row('a','local',{input:1000000,output:100000,cacheRead:2000000,cacheWrite:400000})]).rows[0];
  const p=priceUsage(r,tiered);assert.equal(p.lowCost,1.9);assert.equal(p.highCost,3.6999999999999997);
  const noCache=priceUsage(r,tiered,{cacheMode:'none'});assert.equal(noCache.lowCost,3.6);assert.equal(noCache.highCost,7.1);
  assert.equal(priceUsage(r,{...tiered,rates:{...offer.rates,cacheRead:null}}).lowCost,null);
  const onlyCache=parse([row('cache','local',{input:0,output:0,cacheRead:300000})]).rows[0];assert.equal(priceUsage(onlyCache,tiered).hasRange,true);
});
test('context fields validate even for flat-price and empty comparisons',()=>{
  for(const contextLimit of [null,0,-1,1.5,Infinity,'270k',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>contextSettings('limit',contextLimit));
  assert.throws(()=>contextSettings('invalid'));assert.deepEqual(contextSettings('range',270000),{contextMode:'range',contextLimit:null});
  const r=parse([row()]).rows[0];for(const contextMode of ['range','standard','long','limit'])assert.equal(priceUsage(r,offer,{contextMode,contextLimit:270000}).cost,1.2);
});
test('range summaries keep missing-price rows distinct from context uncertainty',()=>{
  const rows=parse([row('a'),row('b')]).rows,prices=new Map([[rows[0].key,priceUsage(rows[0],tiered)],[rows[1].key,priceUsage(rows[1],null)]]),sum=summarize(rows,prices);
  assert.equal(sum.complete,false);assert.equal(sum.coverage,0.5);assert.equal(sum.lowCost,1.2);assert.equal(sum.highCost,2.3);assert.equal(sum.cost,null);
  const zero=priceUsage(rows[0],{...tiered,rates:{input:0,output:0,cacheRead:0,cacheWrite:0}});assert.equal(zero.lowCost,0);assert.equal(zero.highCost,0);assert.equal(zero.cost,0);
});
test('savings never choose a winner when the range crosses or touches hardware cost',()=>{
  assert.equal(compareCosts(10,20,15).winner,'uncertain');assert.equal(compareCosts(10,20,10).winner,'uncertain');assert.equal(compareCosts(10,20,20).winner,'uncertain');
  assert.equal(compareCosts(10,20,5).winner,'hardware');assert.equal(compareCosts(10,20,25).winner,'hosted');assert.equal(compareCosts(0,0,0).winner,'equal');assert.equal(compareCosts(null,null,5).winner,'unavailable');
  assert.throws(()=>compareCosts(20,10,5));
});
test('large mixed-volume import prices every token under Astra scenarios',()=>{
  const rows=parse([row('large','ollama',{input:450000000,output:36269477}),row('small','ollama',{input:44000,output:832})]).rows;
  const astra=catalog.models.find(m=>m.id==='openai-astra'),sum=summarize(rows,new Map(rows.map(r=>[r.key,priceUsage(r,astra)])));
  assert.equal(sum.tokens,486314309);assert.equal(sum.pricedTokens,486314309);assert.equal(sum.coverage,1);assert.equal(sum.complete,true);assert.ok(sum.lowCost>6000);assert.ok(sum.highCost>sum.lowCost);
});
test('character-count context snapshots are not inferred as token limits',()=>{
  const parsed=parse([row()],{sessions:[{contextWeight:{systemPrompt:{chars:270000},currentTurn:{promptChars:100}}}]});
  const p=priceUsage(parsed.rows[0],tiered);assert.equal(p.hasRange,true);assert.ok(parsed.warnings.some(w=>w.includes('character counts')));
});
test('tiered catalogs require complete positive long-context metadata',()=>{
  const incomplete=structuredClone(catalog);delete incomplete.models.find(m=>m.maxStandardPrompt).longContextMultipliers;assert.throws(()=>validateCatalog(incomplete),/multipliers/);
  const invalid=structuredClone(catalog);invalid.models.find(m=>m.maxStandardPrompt).longContextMultipliers.output=0.5;assert.throws(()=>validateCatalog(invalid),/at least one/);
});
test('scheduled prices and expiry dates are respected',()=>{const r=parse([row()]).rows[0],scheduled={...offer,schedule:[{from:'2027-01-01',rates:{input:2,output:4}}]};assert.equal(priceUsage(r,scheduled,{date:'2026-12-31'}).cost,1.2);assert.equal(priceUsage(r,scheduled,{date:'2027-01-01'}).cost,2.4);assert.equal(priceUsage(r,{...offer,validThrough:'2026-12-31'},{date:'2027-01-01'}).cost,null);});
test('depreciation is capped and purchase is counted once',()=>{assert.equal(hardwareCost(hardware,1095).hardware,1200);assert.equal(hardwareCost(hardware,365.25).hardware,1200);assert.equal(hardwareCost({...hardware,accounting:'purchase'},1).hardware,1200);assert.equal(hardwareCost({...hardware,accounting:'purchase'},1095).hardware,1200);assert.equal(hardwareCost({...hardware,scenario:'owned'},1095).hardware,0);});
test('zero inputs, idle power, allocation and bounds work',()=>{
  assert.equal(hardwareCost({...hardware,electricity:true,rate:0},30).electricity,0);assert.equal(hardwareCost({...hardware,electricity:true,hours:0,idleWatts:0},30).electricity,0);
  assert.equal(hardwareCost({...hardware,electricity:true,hours:0,idleWatts:100,rate:1,share:50},1).electricity,1.2);assert.equal(hardwareCost({...hardware,share:0},100).total,0);
  assert.throws(()=>hardwareCost({...hardware,electricity:true,hours:25},1));assert.throws(()=>hardwareCost({...hardware,months:0},1));
});
