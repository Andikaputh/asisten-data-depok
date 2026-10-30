import {readFileSync,statSync} from 'node:fs';
import {createStore} from '../server/store.js';
import {restoreBackup} from '../server/backup.js';

const MAX_CLI_BYTES=256*1024*1024;
const args=process.argv.slice(2);
const option=name=>{const hit=args.find(arg=>arg.startsWith(`--${name}=`));return hit?.slice(name.length+3);};
const file=args.find(arg=>!arg.startsWith('--'));
if(!file) {
  console.error('Pakai: npm.cmd run restore -- data/backups/cadangan-....json [-- --dry-run] [-- --as-unverified]');
  process.exit(1);
}
const size=statSync(file).size;
if(size>MAX_CLI_BYTES) {
  console.error(`Berkas cadangan ${(size/1024/1024).toFixed(1)} MB melebihi batas ${MAX_CLI_BYTES/1024/1024} MB.`);
  process.exit(1);
}
const backup=JSON.parse(readFileSync(file,'utf8'));
const dryRun=args.includes('--dry-run');
const asUnverified=args.includes('--as-unverified');
if(!dryRun) console.error('Hentikan server (npm start) sebelum memulihkan agar tidak ada penulisan bersamaan. Melanjutkan…');

const store=createStore(option('db') || process.env.DB_FILE || 'data/corpus.sqlite',false);
try {
  const result=restoreBackup(store,backup,{asUnverified,dryRun});
  console.log(JSON.stringify({file,...result},null,2));
  if(!dryRun && result.documents.added) console.error('Bangun ulang indeks embedding melalui Workspace setelah pemulihan bila pencarian semantik diperlukan.');
} finally {store.close();}
