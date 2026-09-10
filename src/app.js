(() => {
  'use strict';
  const {BUCKETS, ROLES, MAX_IMPORT_BYTES, parseUsage, resolveMapping, isExactMatch, searchCatalog, suggestedOffers, priceUsage, summarize, hardwareCost, compareCosts, contextSettings, period, number} = Core;
  const $ = id => document.getElementById(id);
  const money = value => value === null ? 'Unavailable' : value > 0 && value < 0.01 ? '<$0.01' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
  const count = value => value === null ? 'Unknown' : new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value);
  const costText = (low, high = low) => low === null ? 'Price unknown' : low === high ? money(low) : `${money(low)} – ${money(high)}`;
  const estimateText = estimate => costText(estimate.lowCost, estimate.highCost);
  const today = () => new Date().toISOString().slice(0,10);
  const create = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'checked' || key === 'disabled') node[key] = !!value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    return node;
  };
  const option = (value, label) => create('option',{value},label);
  const rateLabel = offer => `${offer.name} · ${offer.provider} · $${offer.rates.input}/$${offer.rates.output} per 1M in/out${offer.priceConflict?' · price conflict':''}`;
  const fieldNumber = (id, optional = false) => number($(id).value === '' ? null : Number($(id).value), $(id).closest('label')?.textContent.trim() ?? id, {optional});
  let usage = null, configurations = new Map(), alternatives = new Map(), editingKey = null, latestReport = null;
  let importGeneration = 0;
  function config(row) { return configurations.get(row.key); }
  function offerFor(row) { const c = config(row); return c.custom ?? CATALOG.models.find(m => m.id === c.offerId) ?? null; }
  function selectedRows(role = $('roleFilter').value) { return usage.rows.filter(row => config(row).included && (role === 'All' || config(row).role === role)); }
  function alternativeScenario(id, settings, pricingOptions = choices()) {
    const offer=CATALOG.models.find(model=>model.id===id),rows=selectedRows(settings.scope==='Selected' ? $('roleFilter').value : settings.scope);
    const prices=new Map(rows.map(row=>[row.key,priceUsage(row,offer,pricingOptions)]));
    return {id,offer,scope:settings.scope,showOnProjection:settings.showOnProjection,rows,prices,summary:summarize(rows,prices)};
  }
  function choices() {
    return {cacheMode:$('cacheMode').value, ...contextSettings($('contextMode').value,
      $('contextMode').value === 'limit' ? fieldNumber('contextLimit') : null), date:today()};
  }
  function readHardware() {
    const buying = $('hwScenario').value === 'buy';
    return {scenario:$('hwScenario').value, accounting:$('hwAccounting').value, price:buying ? fieldNumber('hwPrice') : 0,
      months:buying && $('hwAccounting').value === 'depreciation' ? fieldNumber('hwMonths') : 36, share:fieldNumber('hwShare'),
      electricity:$('elecEnabled').checked, watts:$('elecEnabled').checked ? fieldNumber('hwWatts') : 0,
      idleWatts:$('elecEnabled').checked ? fieldNumber('hwIdle') : 0, hours:$('elecEnabled').checked ? fieldNumber('hwHours') : 0,
      rate:$('elecEnabled').checked ? fieldNumber('hwRate') : 0};
  }
  function settingsVisibility() {
    $('purchaseFields').hidden = $('hwScenario').value !== 'buy';
    $('monthsLabel').hidden = $('hwAccounting').value !== 'depreciation';
    $('electricityFields').hidden = !$('elecEnabled').checked;
    $('contextLimitLabel').hidden = $('contextMode').value !== 'limit';
  }
  function showError(error, id='error') { $(id).textContent = error.message; $(id).hidden = false; }
  function invalidateInput() {
    importGeneration++;
    if (usage) { $('results').hidden = true; latestReport = null; $('importStatus').textContent = 'Input changed — analyze to update results'; }
  }
  function importUsage(raw, synthetic = false) {
    importGeneration++;
    $('error').hidden = true;
    try {
      const next = parseUsage(raw);
      const nextConfigurations = new Map();
      next.rows.forEach(row => nextConfigurations.set(row.key, configurations.get(row.key) ?? {
        included:true, role:'Unassigned', offerId:resolveMapping(row.model,CATALOG)?.id ?? '', custom:null
      }));
      usage = next;
      configurations = nextConfigurations;
      $('jsonInput').value = raw;
      $('startDate').value = usage.period?.start ?? '';
      $('endDate').value = usage.period?.end ?? '';
      $('importStatus').textContent = synthetic ? 'Synthetic demo · not your usage' : `${usage.rows.length} model/provider entries imported`;
      $('results').hidden = false;
      renderModels();
      render();
    } catch (error) { usage = null; latestReport = null; $('results').hidden = true; $('importStatus').textContent = 'Import failed'; showError(error); }
  }
  async function readFile(file) {
    if (!file) return;
    const generation = ++importGeneration;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('The file exceeds 10 MB. Export a shorter date range.');
      const raw = await file.text();
      if (generation === importGeneration) importUsage(raw);
    } catch (error) { if (generation === importGeneration) { invalidateInput(); showError(error); } }
  }
  function pricingDetails(offer, row = null) {
    const box = create('div');
    if (!offer) { box.append(create('p',{class:'meta'},'No priced exact match selected. Choose a priced alternative below or search the bundled catalog.')); return box; }
    if (offer.status === 'needs-review') {
      box.append(create('p',{class:'warn'},'Historical mapping · price needs review'));
    } else {
      const rates = [...(offer.schedule ?? [])].reverse().find(s => s.from <= today())?.rates ?? offer.rates;
      box.append(create('p',{class:'meta'},`$/1M: input ${rates.input ?? '—'} · output ${rates.output ?? '—'} · cache read ${rates.cacheRead ?? '—'} · cache write ${rates.cacheWrite ?? '—'}`));
      const match = row && isExactMatch(row.model,offer,CATALOG);
      box.append(create('p',{class:'meta'},`${match ? 'Model identity match' : 'Alternative scenario'} · ${offer.provider} · ${offer.custom ? 'User-supplied rates' : offer.status==='catalog'?`Catalog snapshot ${offer.observedAt} · ${offer.snapshotSource}`:`Checked ${offer.verifiedAt}`}`));
      if(offer.priceConflict)box.append(create('p',{class:'warn'},'Catalog sources disagree on this price. This selection uses the displayed source, not an average.'));
      if(offer.contextLimit)box.append(create('p',{class:'meta'},`Listed endpoint input/context capacity: ${count(offer.contextLimit)} tokens`));
    }
    const details=create('details',{},create('summary',{},'Source & pricing conditions'),create('p',{class:'meta'},offer.notes),create('p',{class:'meta'},`Hosted model ID: ${offer.modelId}`));
    if (offer.source?.startsWith('https://')) details.append(create('a',{class:'rate-link',href:offer.source,target:'_blank',rel:'noopener noreferrer'},'Pricing source'));
    if (offer.mappingSource?.startsWith('https://')) details.append(create('p',{},create('a',{href:offer.mappingSource,target:'_blank',rel:'noopener noreferrer'},'Ollama model details')));
    box.append(details);
    return box;
  }
  function labelCells(table) {
    const labels=[...table.querySelectorAll('thead th')].map(th=>th.textContent);
    table.querySelectorAll('tbody tr').forEach(tr=>[...tr.children].forEach((td,index)=>td.setAttribute('data-label',labels[index])));
  }
  function renderModels() {
    const tbody = $('usageTable').querySelector('tbody');
    tbody.replaceChildren();
    usage.rows.forEach((row,index) => {
      const c = config(row), offer = offerFor(row);
      const include = create('input',{type:'checkbox',checked:c.included,'aria-label':`Include ${row.model} from ${row.provider}`,onChange:event => {c.included=event.target.checked;render();}});
      const name = create('td',{},create('div',{class:'row-model'},include,create('div',{},create('strong',{},row.model),create('p',{class:'meta'},row.provider))));
      const tokens = create('div',{class:'token-list'});
      for (const [key,label] of [['input','Input'],['output','Output'],['cacheRead','Cache read'],['cacheWrite','Cache write']]) tokens.append(create('span',{},label),create('span',{},count(row[key])));
      const counts = create('td',{},tokens,create('p',{class:'meta'},`${count(row.count)} requests · ${count(row.tokens)} total`));
      if (row.recordedCost !== null) counts.append(create('p',{class:'meta'},`Recorded: ${money(row.recordedCost)}${row.recordedComplete ? '' : ' (partial)'}`));
      const role = create('select',{'aria-label':`Role for ${row.model} from ${row.provider}`,onChange:event=>{c.role=event.target.value;render();}},ROLES.map(r=>option(r,r)));
      role.value = c.role;
      const picker = create('select',{id:`modelPicker-${index}`,'aria-label':`Hosted comparison for ${row.model} from ${row.provider}`,onChange:event=>{
        c.offerId=event.target.value;c.custom=null;renderModels();render();$(`modelPicker-${index}`).focus();
      }},option('','Choose a model / price unknown'));
      if (c.custom) picker.append(option('custom',`${c.custom.name} (custom)`));
      const suggestions=suggestedOffers(row.model,CATALOG);
      const search=create('input',{type:'search',id:`modelSearch-${index}`,placeholder:'Search model or provider','aria-label':`Search catalog for ${row.model} from ${row.provider}`});
      const searchStatus=create('p',{class:'meta',id:`modelSearchStatus-${index}`});
      function fillPicker(){
        const found=searchCatalog(CATALOG,search.value,row.model);
        const available=[...new Map([...(offer?[offer]:[]),...(search.value?[]:suggestions),...found].map(m=>[m.id,m])).values()];
        picker.replaceChildren(option('','Choose a model / price unknown'));
        if(c.custom)picker.append(option('custom',`${c.custom.name} (custom)`));
        available.filter(m=>!m.custom).forEach(m=>picker.append(option(m.id,m.status==='needs-review'?`${m.name} · archived / unpriced`:rateLabel(m))));
        picker.value=c.custom?'custom':c.offerId;
        searchStatus.textContent=`${found.length===100?'First 100':found.length} search results · ${count(CATALOG.models.filter(m=>m.status!=='needs-review').length)} bundled offers. Selecting an alternative accepts a different-model scenario.`;
      }
      fillPicker();search.addEventListener('input',fillPicker);
      picker.value = c.custom ? 'custom' : c.offerId;
      const suggestionBox=create('div',{class:'suggestions'});
      if(!offer||offer.status==='needs-review')suggestions.forEach(s=>suggestionBox.append(create('button',{onClick:()=>{c.offerId=s.id;c.custom=null;renderModels();render();}},`${isExactMatch(row.model,s,CATALOG)?'Use identity match':'Use alternative'}: ${rateLabel(s)}`)));
      const hosted = create('td',{},search,picker,searchStatus,pricingDetails(offer,row),suggestionBox,create('div',{class:'row-actions'},create('button',{onClick:()=>openPricing(row)},c.custom ? 'Edit custom rates' : 'Set custom rates')));
      tbody.append(create('tr',{},name,counts,create('td',{},role),hosted,create('td',{id:`modelCost-${index}`})));
    });
    labelCells($('usageTable'));
  }
  function openPricing(row) {
    editingKey = row.key;
    const selected = offerFor(row),offer=selected?.status==='needs-review'?null:selected;
    $('pricingModel').textContent = `${row.model} · ${row.provider}`;
    $('customName').value = offer?.name ?? row.model;
    $('customProvider').value = offer?.provider ?? 'Custom';
    const effective=[...(offer?.schedule??[])].reverse().find(s=>s.from<=today())?.rates??offer?.rates;
    for (const key of BUCKETS) $(`custom${key[0].toUpperCase()+key.slice(1)}`).value = effective?.[key] ?? '';
    $('customError').hidden = true;
    $('pricingDialog').showModal();
  }
  function savePricing(event) {
    event.preventDefault();
    try {
      const name=$('customName').value.trim(),provider=$('customProvider').value.trim();
      if (!name || !provider) throw new Error('Enter a model name and provider.');
      const rates={};
      for(const key of BUCKETS) rates[key]=fieldNumber(`custom${key[0].toUpperCase()+key.slice(1)}`,key.startsWith('cache'));
      const row=usage.rows.find(r=>r.key===editingKey);
      config(row).custom={id:'custom',modelId:row.model,name,provider,rates,status:'verified',comparison:'alternative',custom:true,notes:'User-supplied flat rates; applicability and source are not independently verified.'};
      $('pricingDialog').close();renderModels();render();
    }catch(error){showError(error,'customError');}
  }
  function card(label,value,detail,tone='') { return create('div',{class:'card'},create('h3',{},label),create('div',{class:`value ${tone}`},value),create('p',{},detail)); }
  function differenceDisplay(comparison) {
    const {winner, lowDifference: low, highDifference: high} = comparison;
    if (winner === 'unavailable') return {value:'Unavailable',detail:'Complete pricing and an observation interval required'};
    if (winner === 'uncertain') return {value:'Depends on context',detail:`Hosted minus hardware: ${costText(low,high)}. The range touches or crosses equal cost; neither option is consistently cheaper.`};
    if (winner === 'equal') return {value:money(0),detail:'Scenarios are equal under these assumptions'};
    return {value:winner === 'hardware' ? costText(low,high) : costText(-high,-low),
      detail:winner === 'hardware' ? 'Lower modeled cost with this hardware scenario across the selected range' : 'Lower modeled cost with the hosted scenario across the selected range'};
  }
  function drawProjection(rows, summary, days, hardware, canCompare, prices, alternateScenarios) {
    const host=$('projectionPanel');host.replaceChildren();
    const horizon=Number($('projectionRange').value);
    if(!days || !canCompare){
      host.append(create('p',{class:'warn'},'Projection needs the following items resolved:'));
      const issues=[];
      if(!days)issues.push('Set both observation dates.');
      if(!usage.complete)issues.push('The source export is incomplete or inconsistent.');
      if(!rows.length)issues.push('Select at least one model.');
      rows.filter(row=>prices.get(row.key).lowCost===null).forEach(row=>issues.push(`${row.model} (${row.provider}): ${prices.get(row.key).reason}`));
      host.append(create('ul',{},issues.map(issue=>create('li',{},issue))));return null;
    }
    const apiLowAt=d=>summary.lowCost/days*d,apiHighAt=d=>summary.highCost/days*d,selfAt=d=>hardwareCost(hardware,d).total;
    const apiLow=apiLowAt(horizon),apiHigh=apiHighAt(horizon),self=selfAt(horizon);
    const series=[{label:'Current hosted scenario',low:apiLow,high:apiHigh,hasRange:summary.hasRange,color:'#b3a0ff'},...alternateScenarios.map((scenario,index)=>({label:`${scenario.offer.name} · ${scenario.offer.provider}`,low:scenario.summary.lowCost/days*horizon,high:scenario.summary.highCost/days*horizon,hasRange:scenario.summary.hasRange,color:['#d3c2ff','#9c8af0','#e0a7ff','#bc91ee'][index%4]}))];
    host.append(create('div',{class:'projection-totals'},create('span',{},'Hosted scenario: ',create('strong',{},costText(apiLow,apiHigh))),...series.slice(1).map(item=>create('span',{},`${item.label}: `,create('strong',{},costText(item.low,item.high)))),create('span',{},'Allocated hardware + power: ',create('strong',{},money(self)))));
    host.append(create('div',{class:'projection-legend'},...series.map(item=>create('span',{},create('i',{class:'legend-swatch',style:`--line-color:${item.color}`}),item.hasRange?`${item.label} range`:item.label)),create('span',{},create('i',{class:'legend-swatch',style:'--line-color:#76dfc1'}),'Hardware + power')));
    const svgNS='http://www.w3.org/2000/svg';
    const svg=(tag,attrs,text)=>{const node=document.createElementNS(svgNS,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;return node;};
    const chart=svg('svg',{viewBox:'0 0 760 270',class:'plot',role:'img','aria-label':`Constant usage projection over ${horizon} days. ${series.map(item=>`${item.label} ${costText(item.low,item.high)}`).join('. ')}. Hardware and electricity ${money(self)}.`});
    const max=Math.max(...series.map(item=>item.high),self,1),x=d=>80+d/horizon*640,y=cost=>220-cost/max*180;
    for(let i=0;i<=4;i++){const cost=max*i/4;chart.append(svg('line',{x1:80,y1:y(cost),x2:720,y2:y(cost),stroke:'#343d53'}),svg('text',{x:70,y:y(cost)+4,'text-anchor':'end'},money(cost)));}
    chart.append(svg('text',{x:80,y:246},'Day 0'),svg('text',{x:720,y:246,'text-anchor':'end'},`${horizon} days`));
    const points=new Set([0,horizon]);
    for(let i=1;i<60;i++)points.add(horizon*i/60);
    if(hardware.scenario==='buy'&&hardware.accounting==='depreciation')points.add(Math.min(horizon,hardware.months*365.25/12));
    const ordered=[...points].sort((a,b)=>a-b);
    for(const item of series){
      const lowAt=d=>item.low/horizon*d,highAt=d=>item.high/horizon*d;
      if(item.hasRange)chart.append(svg('polygon',{points:[...ordered.map(d=>`${x(d)},${y(lowAt(d))}`),...[...ordered].reverse().map(d=>`${x(d)},${y(highAt(d))}`)].join(' '),fill:item.color,'fill-opacity':0.09}),svg('polyline',{points:ordered.map(d=>`${x(d)},${y(highAt(d))}`).join(' '),fill:'none',stroke:item.color,'stroke-width':2,'stroke-dasharray':'6 4'}));
      chart.append(svg('polyline',{points:ordered.map(d=>`${x(d)},${y(lowAt(d))}`).join(' '),fill:'none',stroke:item.color,'stroke-width':3}));
    }
    chart.append(svg('polyline',{points:ordered.map(d=>`${x(d)},${y(selfAt(d))}`).join(' '),fill:'none',stroke:'#76dfc1','stroke-width':3}));
    host.append(chart);
    const comparison=compareCosts(apiLow,apiHigh,self),difference=differenceDisplay(comparison);
    host.append(create('p',{class:comparison.winner==='uncertain'?'warn':''},`${difference.value} over ${horizon} days. ${difference.detail}`));
    const dailyElectricity=hardwareCost(hardware,1).electricity;
    const margin=summary.lowCost/days-dailyElectricity;
    const capital=hardware.price*hardware.share/100;
    const cross=margin>0 ? capital/margin : null;
    if(!summary.hasRange&&hardware.scenario==='buy'&&capital>0&&cross>0&&cross<=horizon&&
      (hardware.accounting==='purchase'||cross>hardware.months*365.25/12))
      host.append(create('p',{class:'meta'},`Cost crossover: about ${Math.ceil(cross)} days under the selected assumptions.`));
    if(summary.hasRange)host.append(create('p',{class:'meta'},'The purple band carries context-pricing uncertainty through the projection. There is no single cost-crossover date until a context scenario is selected.'));
    if(days<7)host.append(create('p',{class:'warn'},'Less than a week of observed usage: this projection is especially sensitive to your chosen interval.'));
    return {days:horizon,hosted:apiLow===apiHigh?apiLow:null,hostedRange:{low:apiLow,high:apiHigh},alternatives:alternateScenarios.map(scenario=>({offer:scenario.offer,scope:scenario.scope,estimatedCostRange:{low:scenario.summary.lowCost/days*horizon,high:scenario.summary.highCost/days*horizon}})),selfHosting:self,comparison,assumptions:'Constant current token rates, usage, declared context scenario and power; no hardware replacement or resale.'};
  }
  function renderAlternatives() {
    const picker=$('alternativePicker'),previous=picker.value;
    const found=searchCatalog(CATALOG,$('alternativeSearch').value).filter(m=>!alternatives.has(m.id));
    picker.replaceChildren(...found.map(m=>option(m.id,rateLabel(m))));
    if([...picker.options].some(o=>o.value===previous))picker.value=previous;
    $('addAlternative').disabled=picker.options.length===0;
    const tbody=$('alternativeTable').querySelector('tbody');tbody.replaceChildren();
    for(const [id,settings]of alternatives){
      const scenario=alternativeScenario(id,settings),{offer,prices,summary:sum}=scenario;
      const select=create('select',{'aria-label':`Usage scope for ${offer.name}`,onChange:event=>{settings.scope=event.target.value;render();}},option('Selected','Current selection'),...ROLES.map(r=>option(r,r)));
      select.value=settings.scope;
      const cell=create('td',{},create('strong',{},sum.lowCost===null?'Price unavailable':`${estimateText(sum)}${sum.complete?'':' subtotal'}`),create('p',{class:'meta'},`${count(sum.pricedTokens)} of ${count(sum.tokens)} tokens priced${sum.hasRange?' · context scenario range':''}`));
      const reasons=[...new Set([...prices.values()].filter(p=>p.reason).map(p=>p.reason))];
      reasons.forEach(reason=>cell.append(create('p',{class:'warn'},reason)));
      [...new Set([...prices.values()].map(p=>p.contextNote).filter(Boolean))].forEach(note=>cell.append(create('p',{class:'meta'},note)));
      const projectionToggle=create('label',{class:'check projection-toggle'},create('input',{type:'checkbox',checked:settings.showOnProjection,'aria-label':`Show ${offer.name} on the projection`,onChange:event=>{settings.showOnProjection=event.target.checked;render();}}),'Show in graph');
      const actions=create('td',{},projectionToggle);
      if(settings.showOnProjection&&!sum.complete)actions.append(create('p',{class:'warn'},'Complete pricing is required before this scenario can be drawn.'));
      actions.append(create('button',{'aria-label':`Remove ${offer.name}`,onClick:()=>{alternatives.delete(id);render();}},'Remove'));
      tbody.append(create('tr',{},create('td',{},create('strong',{},offer.name),pricingDetails(offer)),create('td',{},select),cell,actions));
    }
    $('alternativeTable').hidden=alternatives.size===0;
    labelCells($('alternativeTable'));
  }
  function render() {
    if(!usage)return;
    settingsVisibility();latestReport=null;$('settingsError').hidden=true;$('export').disabled=true;
    try{
      const interval=period($('startDate').value,$('endDate').value),hardware=readHardware();
      hardwareCost(hardware,0); // Validate even before an interval is available.
      const rows=selectedRows(),pricingOptions=choices();
      const prices=new Map(usage.rows.map(row=>[row.key,priceUsage(row,offerFor(row),pricingOptions)]));
      const summary=summarize(rows,prices),warnings=[...usage.warnings];
      if(!rows.length)warnings.push('No models are selected in this role filter.');
      if(rows.length<usage.rows.length)warnings.push(`Comparing ${rows.length} of ${usage.rows.length} model/provider entries. Hardware allocation is ${hardware.share}%; adjust it to match this selection.`);
      if(!summary.complete)warnings.push('Some selected usage is unpriced. The dollar subtotal is not the full cost; savings conclusions are unavailable.');
      if(rows.some(row=>offerFor(row)?.status==='catalog'))warnings.push('Some estimates use a bundled catalog snapshot, not independently verified provider billing. Sources can lag; routing, availability and unreported tiers may differ.');
      if(pricingOptions.contextMode==='limit')warnings.push(`Your declared limit is ${count(pricingOptions.contextLimit)} input tokens per request, applied to every compared model. This does not verify past requests, change your runner settings or account for a different model's tokenizer.`);
      if(rows.some(row=>prices.get(row.key).assumed))warnings.push(summary.hasRange?'Context sizes are unknown. The estimate spans standard through long-context rates for unresolved usage; it is a scenario envelope, not an invoice bound.':'The selected context assumption is not verified by this aggregate export.');
      if(rows.some(row=>prices.get(row.key).stale))warnings.push('At least one selected price was checked over 90 days ago. Verify its source before relying on this scenario.');
      if(pricingOptions.cacheMode==='observed'&&rows.some(r=>r.cacheRead||r.cacheWrite))warnings.push('Observed cache counts are reused for the scenario. Cache eligibility and write duration may differ at the chosen provider.');
      if(!interval)warnings.push('Set both observation dates to compare hardware costs and enable projections.');
      $('warnings').replaceChildren(...[...new Set(warnings)].map(w=>create('li',{},w)));
      const hw=interval?hardwareCost(hardware,interval.days):null;
      const canCompare=summary.complete&&usage.complete&&!!interval;
      const comparison=compareCosts(canCompare?summary.lowCost:null,canCompare?summary.highCost:null,hw?.total??0),difference=differenceDisplay(comparison);
      $('summaryCards').replaceChildren(
        card('Selected tokens',count(summary.tokens),interval?`${interval.days} calendar days · ${interval.start} to ${interval.end}`:'Observation interval unknown'),
        card(summary.complete&&usage.complete?(summary.hasRange?'Hosted estimate range':'Hosted estimate'):'Priced subtotal',estimateText(summary),`${count(summary.pricedTokens)} / ${count(summary.tokens)} reported tokens priced${summary.coverage===null?'':` (${(summary.coverage*100).toFixed(1)}%)`}`,summary.complete?'':'warn'),
        card('Hardware + electricity',hw?money(hw.total):'Set dates',hw?`${money(hw.hardware)} hardware + ${money(hw.electricity)} electricity · ${hardware.share}% allocated`:'Enter an observation interval'),
        card('Scenario difference',difference.value,difference.detail,['unavailable','uncertain'].includes(comparison.winner)?'warn':'')
      );
      usage.rows.forEach((row,index)=>{
        const p=prices.get(row.key),cell=$(`modelCost-${index}`);
        cell.replaceChildren(create('strong',{class:p.lowCost===null?'warn':''},estimateText(p)));
        if(p.reason)cell.append(create('p',{class:'meta'},p.reason));
        if(p.contextNote)cell.append(create('p',{class:'meta'},p.contextNote));
      });
      $('roleBreakdown').replaceChildren(...ROLES.filter(role=>rows.some(row=>config(row).role===role)).map(role=>{
        const subset=rows.filter(row=>config(row).role===role),sum=summarize(subset,prices);
        return create('div',{class:'role-card'},create('strong',{},role),create('p',{},`${count(sum.tokens)} tokens · ${estimateText(sum)}${sum.complete?'':' (incomplete)'}`));
      }));
      const alternateScenarios=[...alternatives].map(([id,settings])=>alternativeScenario(id,settings,pricingOptions)).filter(scenario=>scenario.showOnProjection&&scenario.summary.complete);
      const projection=drawProjection(rows,summary,interval?.days,hardware,canCompare,prices,alternateScenarios);
      renderAlternatives();
      latestReport={schemaVersion:2,type:'openclaw-cost-comparison-report',generatedAt:new Date().toISOString(),catalogDate:CATALOG.updatedAt,pricingDate:pricingOptions.date,
        observation:interval,catalogSnapshot:CATALOG.snapshot,catalogAudit:CATALOG.audit,scope:{role:$('roleFilter').value,selectedModels:rows.length,totalModels:usage.rows.length},pricingAssumptions:pricingOptions,hardware,
        limitations:['Same-token-volume scenario; not equivalent task performance or a provider invoice.','Text-token charges only; no taxes, subscriptions, tool charges, media billing or cache storage.','Recorded OpenClaw costs may be estimates.'],
        summary:{...summary,sourceComplete:usage.complete,conclusionAvailable:canCompare,winnerDetermined:canCompare&&comparison.winner!=='uncertain',comparison},projection,warnings,
        models:usage.rows.map(row=>({...row,role:config(row).role,included:config(row).included,selected:rows.includes(row),offer:offerFor(row),estimatedCost:prices.get(row.key).cost,estimatedCostRange:{low:prices.get(row.key).lowCost,high:prices.get(row.key).highCost},contextNote:prices.get(row.key).contextNote??null,unpricedReason:prices.get(row.key).reason})),
        alternatives:[...alternatives].map(([id,settings])=>{const scenario=alternativeScenario(id,settings,pricingOptions);return{offer:scenario.offer,scope:scenario.scope,showOnProjection:scenario.showOnProjection,summary:scenario.summary};})};
      $('export').disabled=false;
    }catch(error){
      showError(error,'settingsError');$('summaryCards').replaceChildren(card('Check your settings','Unavailable','Correct the highlighted input before using these totals.','warn'));
      $('projectionPanel').replaceChildren();$('roleBreakdown').replaceChildren();$('alternativeTable').querySelector('tbody').replaceChildren();
      usage.rows.forEach((row,index)=>$(`modelCost-${index}`).replaceChildren(create('span',{class:'warn'},'Check settings')));
    }
  }
  function reset(){
    importGeneration++;usage=null;latestReport=null;configurations=new Map();alternatives=new Map();editingKey=null;
    $('jsonInput').value='';$('fileInput').value='';$('importStatus').textContent='';$('results').hidden=true;$('error').hidden=true;
    $('pricingDialog').close();$('roleFilter').value='All';$('cacheMode').value='observed';$('contextMode').value='range';$('contextLimit').value='270000';settingsVisibility();
    $('pricingForm').reset();$('pricingModel').textContent='';$('startDate').value='';$('endDate').value='';
    $('alternativeSearch').value='';
    for(const [id,value]of Object.entries({hwScenario:'owned',hwShare:'100',hwPrice:'0',hwAccounting:'purchase',hwMonths:'36',hwWatts:'100',hwIdle:'0',hwHours:'8',hwRate:'0.12',projectionRange:'365'}))$(id).value=value;
    $('elecEnabled').checked=false;
    for(const id of ['summaryCards','projectionPanel','roleBreakdown','warnings'])$(id).replaceChildren();
    for(const id of ['usageTable','alternativeTable'])$(id).querySelector('tbody').replaceChildren();
    $('jsonInput').focus();
  }
  $('roleFilter').append(...ROLES.map(role=>option(role,role)));
  $('catalogDate').textContent=`${count(CATALOG.models.filter(m=>m.status!=='needs-review').length)} bundled offers · ${CATALOG.updatedAt}`;
  $('catalogAuditSummary').textContent=`Scanned ${count(CATALOG.audit.scanned)} entries from three public sources. Bundled ${count(CATALOG.audit.accepted)} normalized offers; excluded ${count(CATALOG.audit.excluded)} records, merged ${count(CATALOG.audit.duplicates)} duplicates and flagged ${count(CATALOG.audit.conflicts)} price disagreements. Retrieval date: ${CATALOG.updatedAt}. This is a current snapshot, not verified historical pricing.`;
  $('catalogAuditReasons').replaceChildren(...Object.entries(CATALOG.audit.reasons).map(([reason,total])=>create('li',{},`${reason.replaceAll('-',' ')}: ${count(total)}`)));
  $('catalogNotices').textContent=CATALOG.notices;
  $('alternativeSearch').addEventListener('input',()=>{if(usage)renderAlternatives();});
  $('analyze').addEventListener('click',()=>importUsage($('jsonInput').value));
  $('jsonInput').addEventListener('input',invalidateInput);
  $('fileInput').addEventListener('change',()=>readFile($('fileInput').files[0]));
  $('demo').addEventListener('click',()=>importUsage(JSON.stringify(DEMO,null,2),true));
  $('reset').addEventListener('click',reset);
  for(const event of ['dragenter','dragover'])$('dropZone').addEventListener(event,e=>{e.preventDefault();$('dropZone').classList.add('dragging');});
  for(const event of ['dragleave','drop'])$('dropZone').addEventListener(event,e=>{e.preventDefault();$('dropZone').classList.remove('dragging');});
  $('dropZone').addEventListener('drop',event=>readFile(event.dataTransfer.files[0]));
  for(const id of ['startDate','endDate','roleFilter','cacheMode','contextMode'])$(id).addEventListener('change',()=>{if(usage)render();});
  $('contextLimit').addEventListener('input',render);
  $('hardwareSection').addEventListener('input',render);
  $('pricingForm').addEventListener('submit',savePricing);
  $('cancelPricing').addEventListener('click',()=>$('pricingDialog').close());
  $('addAlternative').addEventListener('click',()=>{const id=$('alternativePicker').value;if(id){alternatives.set(id,{scope:'Selected',showOnProjection:false});render();}});
  $('export').addEventListener('click',()=>{
    if(!latestReport)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(latestReport,null,2)],{type:'application/json'}));
    const link=create('a',{href:url,download:'openclaw-cost-comparison.json'});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
})();
