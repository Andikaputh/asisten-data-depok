import {readFile} from 'node:fs/promises';
import {createStore} from '../server/store.js';
const review=JSON.parse(await readFile('data/reviewed-public-sources.json','utf8')),store=createStore();
try {
  const results=[];
  for(const approved of review.sources) {
    const document=store.list().find(item=>item.sourceUrl===approved.url && item.hash===approved.hash && item.status!=='withdrawn');
    if(!document){results.push({url:approved.url,status:'not_found_or_changed'});continue;}
    if(document.status==='unverified')store.verify(document.id,review.reviewer);
    results.push({id:document.id,title:document.title,status:store.get(document.id).status});
  }
  console.log(JSON.stringify(results,null,2));if(results.some(result=>result.status!=='verified'))process.exitCode=1;
}finally{store.close();}
