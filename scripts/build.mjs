import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {Script} from 'node:vm';
import {mergeCatalog, parseUsage} from '../src/core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(resolve(root,path),'utf8');
const [template, styles, core, app, catalogText, demoText, snapshotText, auditText, notices] = await Promise.all(['src/index.html','src/styles.css','src/core.mjs','src/app.js','data/pricing.json','data/demo.json','data/catalog-snapshot.json','data/catalog-audit.json','THIRD_PARTY_NOTICES.md'].map(read));
const snapshot=JSON.parse(snapshotText),catalog=mergeCatalog(JSON.parse(catalogText),snapshot),demo=JSON.parse(demoText),audit=JSON.parse(auditText);
if(audit.accepted!==snapshot.models.length||JSON.stringify(audit.sources)!==JSON.stringify(snapshot.sources))throw new Error('Snapshot and audit do not match.');
catalog.audit={scanned:audit.scanned,accepted:audit.accepted,excluded:audit.excluded,duplicates:audit.duplicates,conflicts:audit.conflicts.length,reasons:audit.reasons,limitations:audit.limitations};
catalog.notices=notices;
parseUsage(demoText);
const embed = data => JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const exports = [...core.matchAll(/^export (?:const|function) (\w+)/gm)].map(match=>match[1]);
const script = `'use strict';\nconst Core=(()=>{\n${core.replace(/^export /gm,'')}\nreturn {${exports.join(',')}};\n})();\nconst CATALOG=${embed(catalog)};\nconst DEMO=${embed(demo)};\n${app}`;
new Script(script,{filename:'built-app.js'});
if(/<\/script/i.test(script)||/<\/style/i.test(styles))throw new Error('Embedded source contains an unsafe closing tag.');
const hash = value => createHash('sha256').update(value).digest('base64');
const html=template.replace('{{SCRIPT_HASH}}',hash(script)).replace('{{STYLE_HASH}}',hash(styles)).replace('{{STYLES}}',()=>styles).replace('{{SCRIPT}}',()=>script);
if(/\{\{(?:SCRIPT|STYLE)/.test(html))throw new Error('Unresolved template marker.');
const auditReport=[
  '# Bundled catalog audit', '', `Snapshot retrieved: ${snapshot.fetchedAt}.`, '',
  `${audit.scanned.toLocaleString('en-US')} records scanned; ${audit.accepted.toLocaleString('en-US')} normalized offers bundled, ${audit.excluded.toLocaleString('en-US')} excluded and ${audit.duplicates} duplicate records merged. ${audit.conflicts.length} cross-source price disagreements are flagged.`, '',
  '## Security result', '',
  `Heuristic suspicious-text matches: ${audit.reasons['suspicious-text']??0}. Prototype-key matches: ${audit.reasons['prototype-key']??0}. These results are not proof that every record is benign or every price is accurate.`, '',
  'The importer uses fixed HTTPS sources, bounded JSON parsing and an allowlist of retained fields. Descriptions, instructions, package/environment fields, commands and source-supplied links are not included in the runtime catalog. No downloaded content is executed. The app renders data with text APIs and a hashed content security policy; it never uploads usage or fetches catalog data at runtime.', '',
  'Synthetic tests exercise instruction injection, script/handler payloads, bidirectional controls, prototype keys, invalid prices, unit conversions, source conflicts and unsupported billing structures.', '',
  '## Exclusions', '', '| Reason | Records |', '| --- | ---: |',
  ...Object.entries(audit.reasons).map(([reason,total])=>`| ${reason.replaceAll('-',' ')} | ${total} |`), '',
  '## Sources and provenance', '',
  ...snapshot.sources.flatMap(source=>[`- ${source.name}: ${source.url}`,`  - SHA-256: \`${source.sha256}\``,`  - Download bytes: ${source.bytes}`]), '',
  'Source priority for duplicate catalog entries: OpenRouter, then Models.dev, then LiteLLM. Conflicting prices are not averaged. Excluded authoritative OpenRouter entries are not restored through weaker flat-rate data. Existing individually reviewed direct-provider offers remain preferred; current OpenRouter observations update older OpenRouter offers.', '',
  `${catalog.snapshot.curatedRateUpdates.length} older curated OpenRouter rate entries were updated from the downloaded snapshot. Exact old/new rates and retained mapping provenance are included in exported reports.`, '',
  '## Limits', '',
  'These are provider/model offers, not unique models or guaranteed purchasable endpoints. A retrieval date is not a historical price effective date. Tier structures that cannot be safely represented, non-text billing, deprecated entries, zero-price/local/subscription records and outliers are excluded. Unknown cache rates remain unknown. Matching a model name does not prove equivalent quantization, quality or tokenizer behavior.', '',
  'The complete machine-readable findings are in data/catalog-audit.json. Source attribution and MIT notices are in THIRD_PARTY_NOTICES.md and embedded in the HTML.', ''
].join('\n');
if(process.argv.includes('--check')){
  if(await read('index.html')!==html)throw new Error('index.html is out of date. Run npm run build and commit the generated file.');
  if(await read('CATALOG_AUDIT.md')!==auditReport)throw new Error('CATALOG_AUDIT.md is out of date. Run the build.');
  console.log('Catalog, demo, JavaScript syntax, CSP hashes and generated HTML are valid.');
}else{
  await writeFile(resolve(root,'index.html'),html);
  await writeFile(resolve(root,'CATALOG_AUDIT.md'),auditReport);
  console.log('Built self-contained index.html with reviewed pricing and hashed CSP.');
}
