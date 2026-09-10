// Pure calculation and import functions. No browser, storage, or network access.
export const BUCKETS = ['input', 'output', 'cacheRead', 'cacheWrite'];
export const ROLES = ['Unassigned', 'Primary', 'Heartbeat', 'Background', 'Other'];
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const DAY = 86400000;
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function number(value, label, { optional = false, integer = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new Error(`${label} is required.`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${label} must be a finite, non-negative${integer ? ' whole' : ''} number${max < Number.MAX_SAFE_INTEGER ? ` no greater than ${max}` : ''}.`);
  }
  return value;
}

export function dateDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use dates in YYYY-MM-DD format.');
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date: ${value}.`);
  return ms / DAY;
}

export function period(start, end) {
  if (!start && !end) return null;
  if (!start || !end) throw new Error('Enter both the start and end of the observation period.');
  const days = dateDay(end) - dateDay(start) + 1;
  if (days < 1) throw new Error('The end date must be on or after the start date.');
  return { start, end, days };
}

function text(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > 500) throw new Error(`${label} must be text of at most 500 characters.`);
  return value;
}

function normalizeRow(entry, index) {
  if (!object(entry)) throw new Error(`Model entry ${index + 1} must be an object.`);
  if (entry.totals !== undefined && !object(entry.totals)) throw new Error(`Model entry ${index + 1} has invalid totals.`);
  const source = entry.totals ?? entry;
  const model = text(entry.model, '(unknown model)', 'Model name');
  const provider = text(entry.provider, '(unknown provider)', 'Provider');
  const buckets = {};
  for (const key of BUCKETS) buckets[key] = number(source[key], `${model}: ${key}`, {optional: true, integer: true});
  // OpenClaw's normalized input excludes cache reads/writes. Older exports omit cache buckets.
  buckets.cacheRead ??= 0;
  buckets.cacheWrite ??= 0;
  const sum = BUCKETS.reduce((s, key) => s + (buckets[key] ?? 0), 0);
  number(sum, `${model}: summed tokens`, {integer: true});
  const reported = number(source.totalTokens, `${model}: totalTokens`, {optional: true, integer: true});
  const tokens = Math.max(reported ?? 0, sum);
  const complete = buckets.input !== null && buckets.output !== null && (reported === null || reported === 0 || reported === sum);
  const recordedCost = number(source.totalCost, `${model}: recorded cost`, {optional: true});
  const missingCostEntries = number(source.missingCostEntries, `${model}: missing cost entries`, {optional: true, integer: true}) ?? 0;
  return {key: JSON.stringify([provider, model]), model, provider, ...buckets, tokens, complete,
    count: number(entry.count, `${model}: request count`, {optional: true, integer: true}), recordedCost,
    recordedComplete: recordedCost !== null && missingCostEntries === 0, missingCostEntries};
}

export function parseUsage(raw) {
  if (typeof raw !== 'string') throw new Error('Import JSON text.');
  if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 10 MB import limit. Export a shorter date range.');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('Invalid JSON. Paste or choose an OpenClaw usage export.'); }
  if (!object(data)) throw new Error('The export must be a JSON object.');
  let entries, format;
  const warnings = [];
  if (data.aggregates !== undefined && !object(data.aggregates)) throw new Error('aggregates must be an object.');
  if (data.aggregates && own(data.aggregates, 'byModel')) { entries = data.aggregates.byModel; format = 'sessions.usage aggregates'; }
  else if (own(data, 'modelUsage')) { entries = data.modelUsage; format = 'modelUsage'; }
  else if (own(data, 'sessions')) {
    if (!Array.isArray(data.sessions)) throw new Error('sessions must be an array.');
    entries = [];
    for (const session of data.sessions) {
      if (!object(session)) throw new Error('Each session must be an object.');
      const rows = session.usage?.modelUsage;
      if (rows !== undefined && !Array.isArray(rows)) throw new Error('Session modelUsage must be an array.');
      if (rows) entries.push(...rows);
      else warnings.push('Some sessions have no per-model usage; their usage cannot be priced.');
    }
    format = 'session list';
    warnings.push('A session-only export may be limited or contain overlapping historical sessions. Prefer the Control UI export with aggregates.byModel.');
  } else {
    throw new Error('No per-model usage found. Export JSON from OpenClaw Control UI → Usage, or use sessions.usage. gateway usage-cost is a summary and is not sufficient.');
  }
  if (!Array.isArray(entries)) throw new Error('Per-model usage must be an array.');
  if (entries.length > 20000) throw new Error('Too many model entries. Export a shorter date range.');
  const grouped = new Map();
  let excluded = 0;
  entries.forEach((entry, index) => {
    const row = normalizeRow(entry, index);
    if (row.provider === 'openclaw') { excluded += row.tokens; return; }
    if (row.tokens === 0 && row.complete && row.recordedCost === null) return;
    const previous = grouped.get(row.key);
    if (!previous) { grouped.set(row.key, row); return; }
    for (const key of BUCKETS) previous[key] = previous[key] === null || row[key] === null ? null : number(previous[key] + row[key], key, {integer: true});
    previous.tokens = number(previous.tokens + row.tokens, 'Total tokens', {integer: true});
    previous.count = previous.count === null || row.count === null ? null : number(previous.count + row.count, 'Request count', {integer: true});
    previous.complete &&= row.complete;
    previous.recordedCost = previous.recordedCost === null && row.recordedCost === null ? null : (previous.recordedCost ?? 0) + (row.recordedCost ?? 0);
    previous.recordedComplete &&= row.recordedComplete;
    previous.missingCostEntries += row.missingCostEntries;
  });
  const rows = [...grouped.values()];
  if (!rows.length) throw new Error('No usable model usage found in this export.');
  if (rows.length > 500) throw new Error('This export has more than 500 distinct models. Narrow its scope before importing.');
  let observedPeriod = null;
  if (data.startDate || data.endDate) observedPeriod = period(data.startDate, data.endDate);
  else {
    const daily = data.daily ?? data.aggregates?.daily;
    if (daily !== undefined && !Array.isArray(daily)) throw new Error('daily must be an array.');
    const dates = [...new Set((daily ?? []).map(d => { if (!object(d)) throw new Error('Daily entries must be objects.'); dateDay(d.date); return d.date; }))].sort();
    if (dates.length) {
      observedPeriod = period(dates[0], dates.at(-1));
      warnings.push('Observation dates were inferred from activity. Set the full export interval, including any idle days at either end.');
    } else warnings.push('No observation dates found. Set an interval to enable daily and annual estimates.');
  }
  let complete = rows.every(row => row.complete) && format !== 'session list';
  const tokenTotal = rows.reduce((sum, row) => sum + row.tokens, 0);
  number(tokenTotal, 'Export token total', {integer: true});
  if (data.totals !== undefined && !object(data.totals)) throw new Error('Export totals must be an object.');
  const declaredTotal = number(data.totals?.totalTokens, 'Export totalTokens', {optional: true, integer: true});
  if (declaredTotal !== null && declaredTotal > 0 && declaredTotal !== tokenTotal + excluded) {
    complete = false;
    warnings.push('The export total does not match its per-model rows. Totals are incomplete; comparison conclusions are unavailable.');
  }
  if (!rows.every(row => row.complete)) warnings.push('Some token splits are missing or inconsistent. Those rows remain unpriced.');
  if (rows.some(row => row.recordedCost !== null)) warnings.push('Recorded costs are values from OpenClaw; they may be estimates rather than provider invoice amounts.');
  if (Array.isArray(data.sessions) && data.sessions.some(session => typeof session?.contextWeight?.systemPrompt?.chars === 'number'))
    warnings.push('Context-weight snapshots contain character counts, not complete per-request token history or configured context limits. They are not used to infer a pricing tier.');
  const incompleteStates = new Set(['refreshing', 'partial', 'stale', 'pending', 'incomplete']);
  const incompleteCache = value => object(value) && Object.entries(value).some(([key, state]) =>
    (state === true && incompleteStates.has(key)) ||
    (typeof state === 'string' && incompleteStates.has(state.toLowerCase())) || incompleteCache(state));
  if (incompleteCache(data.cacheStatus)) {
    complete = false;
    warnings.push('OpenClaw marked this export as refreshing, partial, or stale. Export it again after its usage cache finishes refreshing.');
  }
  if (excluded) warnings.push(`${excluded.toLocaleString()} internal OpenClaw tokens were excluded.`);
  return {rows, period: observedPeriod, complete, format, warnings: [...new Set(warnings)]};
}

export function resolveMapping(model, catalog) {
  const name = model.replace(/^ollama\//, '');
  const explicit=catalog.models.find(item=>item.aliases.includes(name)&&item.status!=='needs-review');
  if(explicit)return explicit;
  const exact=catalog.models.filter(item=>item.status!=='needs-review'&&!item.priceConflict&&modelIdentity(item.modelId)===modelIdentity(name));
  const rank=offer=>offer.status==='verified'?0:offer.snapshotSource==='openrouter'?1:offer.snapshotSource==='modelsdev'?2:3;
  if(exact.length)return exact.sort((a,b)=>rank(a)-rank(b)||a.provider.localeCompare(b.provider))[0];
  // Historical alternatives are recognition hints, never automatic priced matches.
  return catalog.models.find(item=>item.aliases.includes(name)&&item.comparison==='same-model')??null;
}

export function modelIdentity(name) {
  // Normalize separators only; preserve family version, size, quantization,
  // instruct/coder/VL, active-parameter suffixes and other variant distinctions.
  return String(name).toLowerCase().split('/').at(-1).replace(/[\s:_-]+/g,'');
}

export function isExactMatch(model,offer,catalog) {
  if(!offer||offer.custom)return false;
  if(modelIdentity(model)===modelIdentity(offer.modelId))return true;
  const mapped=resolveMapping(model,catalog);
  return !!mapped&&mapped.status!=='needs-review'&&modelIdentity(mapped.modelId)===modelIdentity(offer.modelId);
}

export function searchCatalog(catalog,query='',localModel='',limit=100) {
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const local=modelIdentity(localModel),family=local.match(/^[a-z]+/)?.[0];
  return catalog.models.filter(m=>m.status!=='needs-review'&&terms.every(term=>`${m.name} ${m.modelId} ${m.provider} ${m.providerKey??''}`.toLowerCase().includes(term)))
    .map(m=>({m,score:modelIdentity(m.modelId)===local?0:family&&modelIdentity(m.modelId).startsWith(family)?1:m.status==='verified'?2:3}))
    .sort((a,b)=>a.score-b.score||Number(!!a.m.priceConflict)-Number(!!b.m.priceConflict)||a.m.name.localeCompare(b.m.name)||a.m.provider.localeCompare(b.m.provider))
    .slice(0,limit).map(({m})=>m);
}

export function suggestedOffers(model,catalog) {
  const mapped=resolveMapping(model,catalog),identities=new Set([modelIdentity(model)]);
  if(mapped&&mapped.status!=='needs-review')identities.add(modelIdentity(mapped.modelId));
  const exact=catalog.models.filter(m=>m.status!=='needs-review'&&identities.has(modelIdentity(m.modelId)));
  if(exact.length)return exact.slice(0,6);
  const historical=catalog.models.find(m=>m.status==='needs-review'&&m.aliases.includes(model));
  const variantBase=/-mlx$/i.test(model)?resolveMapping(model.replace(/-mlx$/i,''),catalog):null;
  const hint=historical?.name.replace(/\s*\(closest\)$/i,'')??variantBase?.modelId;
  if(!hint)return [];
  return catalog.models.filter(m=>m.status!=='needs-review'&&(modelIdentity(m.modelId)===modelIdentity(hint)||modelIdentity(m.name)===modelIdentity(hint))).slice(0,6);
}

export function mergeCatalog(curated,snapshot) {
  validateCatalog(curated);validateCatalog(snapshot);
  const used=new Set(),updates=[],models=curated.models.map(offer=>{
    const provider=offer.provider.toLowerCase().replace(/\s+/g,'');
    const current=snapshot.models.find(m=>m.snapshotSource==='openrouter'&&provider==='openrouter'&&modelIdentity(m.modelId)===modelIdentity(offer.modelId));
    if(!current||offer.status==='needs-review')return offer;
    used.add(current.id);
    if(BUCKETS.some(key=>offer.rates[key]!==current.rates[key]))updates.push({id:offer.id,previousRates:offer.rates,snapshotRates:current.rates});
    return {...offer,...current,id:offer.id,aliases:offer.aliases,comparison:offer.comparison,mappingSource:offer.mappingSource,verifiedAt:undefined,mappingVerifiedAt:offer.verifiedAt,
      reviewedMapping:true,notes:current.notes+' Local alias mapping retained from the reviewed catalog.'};
  });
  const snapshotModels=snapshot.models.filter(m=>!used.has(m.id)&&!models.some(c=>c.status==='verified'&&c.provider.toLowerCase().replace(/\s+/g,'')===m.providerKey&&modelIdentity(c.modelId)===modelIdentity(m.modelId)));
  return validateCatalog({schemaVersion:1,updatedAt:snapshot.updatedAt,models:[...models,...snapshotModels],snapshot:{fetchedAt:snapshot.fetchedAt,sources:snapshot.sources,offers:snapshot.models.length,curatedRateUpdates:updates}});
}

export function contextSettings(contextMode = 'range', contextLimit = null) {
  if (!['range', 'standard', 'long', 'limit'].includes(contextMode)) throw new Error('Choose a valid context pricing assumption.');
  if (contextMode === 'limit') {
    number(contextLimit, 'Maximum input tokens per request', {integer: true});
    if (contextLimit === 0) throw new Error('The context limit must be greater than zero.');
  }
  return {contextMode, contextLimit: contextMode === 'limit' ? contextLimit : null};
}

export function priceUsage(row, offer, {cacheMode = 'observed', contextMode = 'range', contextLimit = null, date = new Date().toISOString().slice(0, 10)} = {}) {
  contextSettings(contextMode, contextLimit);
  const fail = reason => ({cost: null, lowCost: null, highCost: null, reason});
  if (!offer) return fail('No priced match selected. Choose a catalog offer or enter custom pricing.');
  if (offer.status === 'needs-review') return fail('Historical mapping: current price needs verification.');
  if (!row.complete) return fail('Missing or inconsistent token split.');
  if (offer.validThrough && date > offer.validThrough) return fail('This price has expired. Update or override it.');
  const rates = [...(offer.schedule ?? [])].reverse().find(item => item.from <= date)?.rates ?? offer.rates;
  const prompt = row.input + row.cacheRead + row.cacheWrite;
  // Aggregate volume is not request size. It only rules OUT long context when
  // even the entire group's input fits the standard tier. Otherwise use a
  // scenario envelope, or the user's explicit assumption; never drop the row.
  const tiered = !!offer.maxStandardPrompt;
  const couldBeLong = tiered && prompt > offer.maxStandardPrompt;
  const limited = contextMode === 'limit' && contextLimit <= offer.maxStandardPrompt;
  const useLong = couldBeLong && !limited && contextMode !== 'standard';
  const buckets = {...row};
  if (cacheMode === 'none') { buckets.input = prompt; buckets.cacheRead = 0; buckets.cacheWrite = 0; }
  let standardCost = 0, longCost = 0;
  for (const key of BUCKETS) {
    if (buckets[key] === 0) continue;
    if (rates[key] === null || rates[key] === undefined) return fail(`${key} price is unavailable. Choose no-cache pricing or supply a rate.`);
    number(rates[key], `${key} price`);
    standardCost += buckets[key] * rates[key] / 1000000;
    const multiplier = useLong ? offer.longContextMultipliers?.[key] : 1;
    if (multiplier === null || multiplier === undefined) return fail(`Long-context ${key} price is unavailable. Choose standard context explicitly or supply custom rates.`);
    number(multiplier, `${key} long-context multiplier`);
    longCost += buckets[key] * rates[key] * multiplier / 1000000;
  }
  number(standardCost, 'Calculated standard cost');number(longCost, 'Calculated long-context cost');
  const lowCost = useLong && contextMode === 'long' ? longCost : standardCost;
  const highCost = useLong ? longCost : standardCost;
  let contextNote = null;
  if (tiered) {
    const threshold = offer.maxStandardPrompt.toLocaleString('en-US');
    if (!couldBeLong) contextNote = `Standard rates: this group's total input is at most ${threshold} tokens, so each request fits.`;
    else if (limited) contextNote = `Standard rates using your declared ${contextLimit.toLocaleString('en-US')}-token input limit (≤${threshold}). Not verified by this export.`;
    else if (contextMode === 'standard') contextNote = `Assumes each request has at most ${threshold} input tokens. Not verified by this export.`;
    else if (contextMode === 'long') contextNote = `High-cost scenario: long-context rates applied to this unresolved group. Actual request sizes are unknown.`;
    else contextNote = `Standard-to-long-context scenario range; request sizes are unknown. Threshold: ${threshold} input tokens per request.${contextMode === 'limit' ? ' Your limit is above that threshold, so the range remains.' : ''}`;
  }
  if(offer.contextLimit&&contextMode==='limit'&&contextLimit>offer.contextLimit)
    contextNote=(contextNote?contextNote+' ':'')+`Your declared limit exceeds this endpoint's listed ${offer.contextLimit.toLocaleString('en-US')}-token capacity. This is a rate scenario, not confirmation that the workload fits.`;
  return {cost: lowCost === highCost ? lowCost : null, lowCost, highCost, reason: null, rates, contextNote,
    assumed: couldBeLong, hasRange: lowCost !== highCost,
    stale: offer.observedAt||offer.verifiedAt ? dateDay(date) - dateDay(offer.observedAt??offer.verifiedAt) > 90 : false};
}

export function summarize(rows, prices) {
  const tokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const lower = price => price?.lowCost ?? price?.cost;
  const upper = price => price?.highCost ?? price?.cost;
  const priced = rows.filter(row => lower(prices.get(row.key)) != null && upper(prices.get(row.key)) != null);
  const pricedTokens = priced.reduce((sum, row) => sum + row.tokens, 0);
  const lowCost = priced.length ? priced.reduce((sum, row) => sum + lower(prices.get(row.key)), 0) : null;
  const highCost = priced.length ? priced.reduce((sum, row) => sum + upper(prices.get(row.key)), 0) : null;
  if (lowCost !== null) { number(lowCost, 'Calculated total'); number(highCost, 'Calculated upper total'); }
  return {tokens, pricedTokens, coverage: tokens ? pricedTokens / tokens : null,
    cost: lowCost === highCost ? lowCost : null, lowCost, highCost, hasRange: lowCost !== highCost,
    complete: rows.length > 0 && priced.length === rows.length && rows.every(row => row.complete),
    pricedRows: priced.length, rows: rows.length};
}

export function compareCosts(lowCost, highCost, hardwareTotal) {
  if (lowCost === null || highCost === null) return {winner: 'unavailable', lowDifference: null, highDifference: null};
  number(lowCost, 'Lower hosted cost');number(highCost, 'Upper hosted cost');number(hardwareTotal, 'Hardware total');
  if (highCost < lowCost) throw new Error('The cost range is reversed.');
  const lowDifference = lowCost - hardwareTotal, highDifference = highCost - hardwareTotal;
  const winner = lowDifference === 0 && highDifference === 0 ? 'equal' : lowDifference > 0 ? 'hardware' : highDifference < 0 ? 'hosted' : 'uncertain';
  return {winner, lowDifference, highDifference};
}

export function hardwareCost(settings, days) {
  number(days, 'Observation days');
  const price = number(settings.price, 'Hardware price');
  const share = number(settings.share, 'Hardware allocation', {max: 100}) / 100;
  let hardware = 0;
  if (settings.scenario === 'buy' && settings.accounting === 'purchase') hardware = price;
  else if (settings.scenario === 'buy') {
    const months = number(settings.months, 'Useful life');
    if (months === 0) throw new Error('Useful life must be greater than zero.');
    hardware = Math.min(price, price / (months * (365.25 / 12)) * days);
  }
  let electricity = 0;
  if (settings.electricity) {
    const watts = number(settings.watts, 'Active power');
    const idle = number(settings.idleWatts, 'Idle power');
    const hours = number(settings.hours, 'Active hours per day', {max: 24});
    const rate = number(settings.rate, 'Electricity rate');
    electricity = ((watts * hours + idle * (24 - hours)) / 1000) * rate * days;
  }
  return {hardware: hardware * share, electricity: electricity * share, total: (hardware + electricity) * share};
}

export function validateCatalog(catalog) {
  if (!object(catalog) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.models)) throw new Error('Invalid catalog schema.');
  dateDay(catalog.updatedAt);
  const ids = new Set(), aliases = new Set();
  for (const model of catalog.models) {
    if (!model.id || ids.has(model.id)) throw new Error(`Duplicate or missing catalog id: ${model.id}`);
    ids.add(model.id);
    for (const key of ['modelId', 'name', 'provider', 'notes']) if (typeof model[key] !== 'string') throw new Error(`Missing ${key} for ${model.id}`);
    if (!['verified', 'catalog', 'needs-review'].includes(model.status)) throw new Error(`Invalid status for ${model.id}`);
    if (!['same-model', 'alternative'].includes(model.comparison)) throw new Error(`Invalid comparison for ${model.id}`);
    if (!Array.isArray(model.aliases)) throw new Error(`Missing aliases: ${model.id}`);
    for (const alias of model.aliases) { if (aliases.has(alias)) throw new Error(`Duplicate alias: ${alias}`); aliases.add(alias); }
    const url = new URL(model.source);
    if (url.protocol !== 'https:'||url.username||url.password) throw new Error(`Use an HTTPS pricing source: ${model.id}`);
    dateDay(model.status==='catalog'?model.observedAt:model.verifiedAt);
    if(model.contextLimit!==undefined&&model.contextLimit!==null)number(model.contextLimit,'Endpoint context capacity',{integer:true});
    if (model.validThrough) dateDay(model.validThrough);
    if (model.maxStandardPrompt !== undefined) {
      number(model.maxStandardPrompt, 'Context threshold', {integer: true});
      if (model.maxStandardPrompt === 0) throw new Error('Context threshold must be positive.');
      if (!object(model.longContextMultipliers)) throw new Error(`Missing long-context multipliers for ${model.id}`);
      for (const key of BUCKETS) {
        if(!Object.hasOwn(model.longContextMultipliers,key))throw new Error('Missing long-context multiplier field.');
        const multiplier = number(model.longContextMultipliers[key], `${model.id} ${key} multiplier`,{optional:key.startsWith('cache')});
        if (multiplier!==null&&multiplier < 1) throw new Error('Long-context multipliers must be at least one.');
      }
    }
    for (const rates of [model.rates, ...(model.schedule ?? []).map(item => {dateDay(item.from); return item.rates;})]) {
      if (!object(rates)) throw new Error(`Missing rates for ${model.id}`);
      for (const key of BUCKETS) number(rates[key], `${model.id} ${key}`, {optional: key.startsWith('cache') || model.status === 'needs-review'});
    }
  }
  return catalog;
}
