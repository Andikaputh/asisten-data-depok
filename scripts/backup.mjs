import {existsSync,mkdirSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createStore} from '../server/store.js';
import {buildBackup} from '../server/backup.js';

const args=process.argv.slice(2);
const option=name=>{const hit=args.find(arg=>arg.startsWith(`--${name}=`));return hit?.slice(name.length+3);};
const dbFile=option('db') || process.env.DB_FILE || 'data/corpus.sqlite';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const out=resolve(option('out') || join('data','backups',`cadangan-${stamp}.json`));

if(!existsSync(dbFile)) {
  console.error(`Basis data ${dbFile} tidak ditemukan. Jalankan server atau pengambilan sumber terlebih dahulu.`);
  process.exit(1);
}
const store=createStore(dbFile,false);
try {
  const backup=buildBackup(store);
  mkdirSync(dirname(out),{recursive:true});
  writeFileSync(out,JSON.stringify(backup),'utf8');
  const size=statSync(out).size;
  console.log(JSON.stringify({file:out,bytes:size,summary:backup.summary,note:'Cadangan memuat dokumen, observasi, dan inventaris portal. Vektor embedding tidak disertakan; bangun ulang indeks setelah pemulihan bila diperlukan.'},null,2));
} finally {store.close();}
