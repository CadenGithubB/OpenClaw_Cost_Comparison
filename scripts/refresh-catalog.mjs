// Maintainer-only, explicit one-time refresh. The browser never runs this file.
import {writeFile} from 'node:fs/promises';
import {normalizeCatalogs,SOURCES,digest} from './catalog-import.mjs';
const limit=32*1024*1024;
async function download(name,url){
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{accept:'application/json'}});
  if(!response.ok)throw Error(name+' download failed: '+response.status);
  if(Number(response.headers.get('content-length'))>limit)throw Error(name+' exceeds size limit');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error(name+' exceeds size limit');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),data=JSON.parse(bytes.toString('utf8'));
  return {name,data,manifest:{name,url,bytes:size,sha256:digest(bytes)}};
}
const downloaded=await Promise.all(Object.entries(SOURCES).map(([name,url])=>download(name,url)));
const fetchedAt=new Date().toISOString();
const {snapshot,audit}=normalizeCatalogs(Object.fromEntries(downloaded.map(r=>[r.name,r.data])),fetchedAt.slice(0,10));
snapshot.fetchedAt=fetchedAt;snapshot.sources=downloaded.map(r=>r.manifest);audit.sources=snapshot.sources;
// Write only after every source and normalization succeeded. No source-supplied paths.
await writeFile(new URL('../data/catalog-snapshot.json',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
await writeFile(new URL('../data/catalog-audit.json',import.meta.url),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({scanned:audit.scanned,accepted:audit.accepted,excluded:audit.excluded,duplicates:audit.duplicates,conflicts:audit.conflicts.length,reasons:audit.reasons},null,2));
