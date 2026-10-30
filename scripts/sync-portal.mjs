import {createStore} from '../server/store.js';
import {syncPortal} from '../server/portal-sync.js';

const args=process.argv.slice(2),option=name=>args.find(value=>value.startsWith(`--${name}=`))?.split('=')[1];
const store=createStore(),abort=new AbortController();
process.once('SIGINT',()=>abort.abort());
try {
  const result=await syncPortal(store,{maxPages:Number(option('max-pages') || 40),delayMs:Number(option('delay') || 900),includeDetails:args.includes('--details'),includeAttachments:args.includes('--attachments'),maxAttachments:Number(option('max-attachments') || 5),refresh:args.includes('--refresh'),signal:abort.signal,
    onProgress:progress=>{if(progress.processed===1 || progress.processed%20===0)console.log(JSON.stringify(progress));}});
  console.log(JSON.stringify(result,null,2));
  if(result.lastRun?.status==='failed')process.exitCode=1;
} catch(error){console.error(error.message);process.exitCode=1;}finally{store.close();}
