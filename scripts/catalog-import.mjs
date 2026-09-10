// Remote catalogs are untrusted data. Never execute their code, follow their
// links, load packages they name, or copy free-form descriptions into the app.
import {createHash} from 'node:crypto';
export const SOURCES = {
  modelsdev: 'https://models.dev/api.json',
  openrouter: 'https://openrouter.ai/api/v1/models',
  litellm: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = ['input','output','cacheRead','cacheWrite'];
export const digest = value => createHash('sha256').update(value).digest('hex');
const suspicious = /<\/?(?:script|iframe|object|embed)\b|\bon(?:error|load)\s*=|javascript\s*:|ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|(?:reveal|exfiltrate|send)\s+(?:your\s+)?(?:api\s*keys?|secrets?|credentials)|\[\/?INST\]|<\|(?:system|im_start)\|>|[\u202a-\u202e\u2066-\u2069\u200b-\u200f]/i;
export function scanRecord(value) {
  const stack = [[value,0]];let visited=0;
  while(stack.length){
    const [item,depth]=stack.pop();
    if(++visited>20000||depth>24)return 'oversized-or-deep-record';
    if(typeof item==='string'&&(item.length>100000||suspicious.test(item)))return 'suspicious-text';
    if(item&&typeof item==='object')for(const [key,v]of Object.entries(item)){
      if(['__proto__','prototype','constructor'].includes(key))return 'prototype-key';
      stack.push([v,depth+1]);
    }
  }
  return null;
}
function safeText(value) {
  if(typeof value!=='string'||!value.trim()||value.length>200||['__proto__','constructor','prototype'].includes(value)||/[<>\u0000-\u001f\u007f]/.test(value)||suspicious.test(value))throw Error('invalid-label');
  return value.trim();
}
function rate(value,scale=1,optional=false) {
  if(value===null||value===undefined){if(optional)return null;throw Error('missing-rate');}
  if(typeof value==='string'){
    if(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))throw Error('invalid-rate');
    value=Number(value);
  }
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('invalid-rate');
  const normalized=Number((value*scale).toPrecision(12));
  if(normalized>1000||(normalized>0&&normalized<0.000001))throw Error('rate-outlier');
  return normalized;
}
function rates(input,output,read,write,scale=1){return {input:rate(input,scale),output:rate(output,scale),cacheRead:rate(read,scale,true),cacheWrite:rate(write,scale,true)};}
function limit(value){if(value==null)return null;if(!Number.isSafeInteger(value)||value<=0||value>100000000)throw Error('invalid-context-limit');return value;}
function providerKey(value){const key=value.toLowerCase();return key==='amazon-bedrock'?'bedrock':key==='deep-infra'?'deepinfra':key;}
function modelKey(value,provider){return value.toLowerCase().replace(new RegExp('^'+provider.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/'),'');}
function checkRates(r){
  if(r.input===0||r.output===0)throw Error('zero-price-needs-free-local-or-subscription-review');
  if(r.cacheRead!==null&&r.cacheRead>r.input)throw Error('cache-read-above-input');
  if(r.cacheWrite!==null&&r.cacheWrite>5*r.input)throw Error('cache-write-outlier');
}
function applyTier(offer,threshold,high){
  offer.maxStandardPrompt=limit(threshold);offer.longContextMultipliers={};
  for(const key of keys){
    if(offer.rates[key]===null||high[key]===null){offer.longContextMultipliers[key]=null;continue;}
    const multiple=high[key]/offer.rates[key];
    if(!Number.isFinite(multiple)||multiple<1||multiple>100)throw Error('invalid-tier-ratio');
    offer.longContextMultipliers[key]=multiple;
  }
  if(offer.longContextMultipliers.input===null||offer.longContextMultipliers.output===null)throw Error('missing-tier-rate');
}
function convert(source,provider,id,record,date){
  if(!object(record))throw Error('invalid-record');
  const unsafe=scanRecord(record);if(unsafe)throw Error(unsafe);
  id=safeText(id);provider=safeText(provider);
  if(record.currency!==undefined&&record.currency!=='USD')throw Error('unsupported-currency');
  const p=providerKey(provider),offer={id:'snapshot-'+digest(source+'\n'+p+'\n'+id).slice(0,24),modelId:id,name:safeText(record.name??id),provider,
    providerKey:p,aliases:[],comparison:'alternative',status:'catalog',snapshotSource:source,observedAt:date,source:SOURCES[source],
    notes:'Dated catalog rates for a same-token-volume scenario, not independently verified provider billing. Missing cache rates remain unknown; non-text charges, discounts and taxes are excluded.'};
  if(/(?:^|[/:_-])(?:free|local|subscription|batch|flex|priority)(?:$|[/:_-])/i.test(id)||/ollama|lmstudio|qvac|codex|copilot|subscription|local/i.test(provider))throw Error('nonstandard-or-local-offer');
  if(record.status==='deprecated'||record.deprecation_date&&record.deprecation_date<=date||record.expiration_date&&record.expiration_date<=date)throw Error('deprecated');
  if(source==='modelsdev'){
    if(!record.modalities?.output?.includes('text'))throw Error('non-text-or-unknown-modality');
    const c=record.cost;if(!object(c))throw Error('missing-rate');
    const known=['input','output','cache_read','cache_write','tiers','context_over_200k','reasoning','output_audio','input_audio'];
    if(Object.keys(c).some(key=>!known.includes(key)))throw Error('unsupported-cost-field');
    offer.rates=rates(c.input,c.output,c.cache_read,c.cache_write);
    offer.contextLimit=limit(record.limit?.input??record.limit?.context);
    let tiers=c.tiers;
    if(tiers!==undefined&&!Array.isArray(tiers))throw Error('invalid-tiers');
    if(c.context_over_200k){
      if(!tiers?.length)tiers=[{...c.context_over_200k,tier:{type:'context',size:200000}}];
      else if(tiers.length!==1||tiers[0].tier?.size!==200000||keys.some((key,i)=>{
        const field=['input','output','cache_read','cache_write'][i];return tiers[0][field]!==c.context_over_200k[field];
      }))throw Error('conflicting-tier-definitions');
    }
    if(tiers?.length){
      if(tiers.length!==1||tiers[0].tier?.type!=='context')throw Error('unsupported-multiple-or-noncontext-tiers');
      const t=tiers[0];applyTier(offer,t.tier.size,rates(t.input,t.output,t.cache_read,t.cache_write));
    }
    if(c.reasoning!==undefined&&c.reasoning!==c.output)throw Error('separate-reasoning-rate');
  }else if(source==='openrouter'){
    if(!record.architecture?.output_modalities?.includes('text'))throw Error('non-text-or-unknown-modality');
    const c=record.pricing;if(!object(c))throw Error('missing-rate');
    if(c.overrides?.length||object(c.overrides)&&Object.keys(c.overrides).length)throw Error('unsupported-pricing-overrides');
    if(c.request&&Number(c.request)!==0||c.internal_reasoning&&Number(c.internal_reasoning)!==0)throw Error('extra-request-or-reasoning-charge');
    const known=['prompt','completion','input_cache_read','input_cache_write','overrides','request','web_search','image','audio','input_audio_cache','internal_reasoning','input_cache_write_1h','image_output','audio_output'];
    if(Object.keys(c).some(key=>!known.includes(key)))throw Error('unsupported-cost-field');
    offer.rates=rates(c.prompt,c.completion,c.input_cache_read,c.input_cache_write,1000000);
    offer.contextLimit=limit(record.top_provider?.context_length??record.context_length);
    offer.provider='OpenRouter';offer.priceBasis='listed-route';
    offer.notes+=' OpenRouter catalog routing prices are not a guarantee for a fixed underlying provider.';
  }else{
    if(record.mode!=='chat')throw Error('non-text-or-unknown-modality');
    if(record.tiered_pricing)throw Error('unsupported-tiered-pricing');
    if(record.input_cost_per_request||record.input_cost_per_query||record.output_cost_per_reasoning_token&&record.output_cost_per_reasoning_token!==record.output_cost_per_token)throw Error('extra-request-or-reasoning-charge');
    offer.rates=rates(record.input_cost_per_token,record.output_cost_per_token,record.cache_read_input_token_cost,record.cache_creation_input_token_cost,1000000);
    offer.contextLimit=limit(record.max_input_tokens??record.max_tokens);
    const tiers=[...new Set(Object.keys(record).filter(k=>!/_priority|_flex|_batches|_1hr/.test(k)).map(k=>k.match(/_above_(\d+)k_tokens$/)?.[1]).filter(Boolean))];
    if(tiers.length>1)throw Error('unsupported-multiple-or-noncontext-tiers');
    if(tiers.length){const suffix='_above_'+tiers[0]+'k_tokens';applyTier(offer,Number(tiers[0])*1000,rates(record['input_cost_per_token'+suffix],record['output_cost_per_token'+suffix],record['cache_read_input_token_cost'+suffix],record['cache_creation_input_token_cost'+suffix],1000000));}
    offer.modelId=id.startsWith(provider+'/')?id.slice(provider.length+1):id;
    offer.name=offer.modelId;
  }
  checkRates(offer.rates);
  offer.identity=p+'\n'+modelKey(offer.modelId,p);
  return offer;
}
export function normalizeCatalogs(payloads,date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid snapshot date');
  const audit={schemaVersion:1,date,scanned:0,accepted:0,excluded:0,duplicates:0,conflicts:[],reasons:{},quarantine:[],limitations:[
    'Heuristic scanning cannot prove the absence of prompt injection or pricing errors.',
    'Only allowlisted fields survive normalization; remote prose, URLs, package names and code are never executed.',
    'Zero-price, local/subscription, deprecated, unsupported-tier and anomalous records are excluded, not assumed free.',
    'Catalog disagreements are flagged. A snapshot date records retrieval, not a price effective date.'
  ]};
  const accepted=[],authoritativeExclusions=new Set();
  const visit=(source,provider,id,record)=>{
    if(++audit.scanned>50000)throw Error('Catalog entry limit exceeded');
    try{accepted.push(convert(source,provider,id,record,date));}catch(error){
      audit.excluded++;audit.reasons[error.message]=(audit.reasons[error.message]??0)+1;
      // Opaque references keep suspicious payloads out of the shipped audit too.
      audit.quarantine.push({source,reference:digest(String(provider)+'\n'+String(id)).slice(0,20),reason:error.message});
      if(source==='openrouter'&&typeof id==='string')authoritativeExclusions.add('openrouter\n'+modelKey(id,'openrouter'));
    }
  };
  for(const source of ['openrouter','modelsdev','litellm']){
    const data=payloads[source];if(!object(data))throw Error('Missing catalog: '+source);
    if(source==='openrouter'){
      if(!Array.isArray(data.data)||data.links?.next)throw Error('OpenRouter response is incomplete');
      for(const record of data.data)visit(source,'openrouter',record?.id,record);
    }else if(source==='modelsdev'){
      for(const [provider,p]of Object.entries(data)){if(!object(p.models))throw Error('Invalid provider models');for(const[id,record]of Object.entries(p.models))visit(source,provider,id,record);}
    }else for(const[id,record]of Object.entries(data)){if(id==='sample_spec')continue;visit(source,record?.litellm_provider??'unknown',id,record);}
  }
  const unique=new Map();
  for(const offer of accepted){
    if(offer.snapshotSource!=='openrouter'&&authoritativeExclusions.has(offer.identity)){
      audit.excluded++;audit.reasons['authoritative-entry-excluded']=(audit.reasons['authoritative-entry-excluded']??0)+1;
      audit.quarantine.push({source:offer.snapshotSource,reference:digest(offer.identity).slice(0,20),reason:'authoritative-entry-excluded'});continue;
    }
    const prior=unique.get(offer.identity);
    if(!prior){unique.set(offer.identity,offer);continue;}
    audit.duplicates++;
    const different=keys.filter(key=>prior.rates[key]!==null&&offer.rates[key]!==null&&Math.abs(prior.rates[key]-offer.rates[key])>Math.max(prior.rates[key],offer.rates[key])*0.01);
    if(different.length){
      prior.priceConflict=true;
      prior.notes+=' Another catalog reports different rates; verify the provider before relying on this scenario.';
      audit.conflicts.push({kept:prior.id,otherSource:offer.snapshotSource,fields:different,keptRates:prior.rates,otherRates:offer.rates});
    }
  }
  const models=[...unique.values()].map(({identity,...offer})=>offer).sort((a,b)=>a.provider.localeCompare(b.provider)||a.modelId.localeCompare(b.modelId));
  audit.accepted=models.length;
  return {snapshot:{schemaVersion:1,updatedAt:date,models},audit};
}
