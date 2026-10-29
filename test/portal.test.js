import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createStore} from '../server/store.js';
import {answerQuestion} from '../server/chat.js';
import {createApp} from '../server/index.js';
import {portalUrl,parsePortalPage,robotsRules,robotsAllow,syncPortal,readPortalDetail} from '../server/portal-sync.js';
import {modelConfig,embeddingIdentity,embeddingsReady,modelReady,selectEvidence,embedTexts} from '../server/model.js';
import {composeLocalAnswer} from '../server/grounding.js';
import {retrieve} from '../server/retrieval.js';

const origin='https://satudata.depok.go.id';
const offline={provider:'openai',apiKey:'',chatModel:'fixture',embeddingModel:'',baseUrl:'https://api.openai.com/v1'};
const html=(title,body)=>`<html><head><title>${title}</title></head><body><div class="section-page"><div class="hero-section"><h2>${title}</h2></div></div>${body}</body></html>`;
const listing=html('Dataset',`<div class="card-search"><h6>2 Dataset ditemukan</h6></div>
  <a href="/User/detail_dataset/anak"><div class="card-content"><h6>Jumlah Anak Penyandang Disabilitas Berdasarkan Kelompok Umur</h6><p>Dinas Kependudukan dan Pencatatan Sipil Kota Depok</p><p class="mb-0">2023 - 2026 100 0</p></div></a>
  <a href="/User/detail_dataset/penduduk"><div class="card-content"><h6>Jumlah Penduduk Menurut Kelurahan</h6><p>Dinas Kependudukan dan Pencatatan Sipil Kota Depok</p></div></a><a class="page-link" href="?page=2">Next</a>`);
function inventory(store) {
  const url=origin+'/User/dataset';store.portal.queue(url,'listing','dataset');store.portal.savePage(url,parsePortalPage(listing,{url,kind:'listing',section:'dataset'}));
  store.portal.putItem({url,title:'Dataset',section:'dataset',description:'Katalog dataset publik.',discoveredFrom:origin+'/'});
  store.portal.putItem({url:origin+'/upload/file/kesehatan.pdf',title:'Profil Kesehatan Kota Depok Tahun 2025',section:'publication',format:'PDF',description:'Publikasi kesehatan, isi belum diekstrak.',discoveredFrom:origin+'/User/produk_bidangstatistik'});
}

test('parser inventaris memisahkan judul, penerbit, periode katalog dan nilai observasi',()=>{
  const url=origin+'/User/dataset',result=parsePortalPage(listing,{url,kind:'listing',section:'dataset'});
  assert.equal(result.items.length,2);assert.equal(result.reportedTotal,2);
  assert.equal(result.items[0].periodLabel,'2023 - 2026');
  assert.equal(result.items[0].publisher,'Dinas Kependudukan dan Pencatatan Sipil Kota Depok');
  assert.ok(!('observations' in result));assert.ok(result.links.some(link=>link.url.endsWith('dataset?page=2')));
});

test('tab dan dialog publik ikut dibaca; script serta dialog formulir tidak menjadi bukti',()=>{
  const url=origin+'/User/metadata';
  const result=parsePortalPage(html('Metadata','<section><h3>Metadata Kegiatan</h3><p>Konteks kegiatan statistik tersedia di bagian ini.</p><table><tr><th>Satuan</th><td>Persen</td></tr></table></section><script>SECRET_SCRIPT</script><form><p>PRIVATE_FORM</p></form><div class="modal"><form><p>HIDDEN_FORM</p></form></div><div class="modal"><p>Deskripsi publik dari dialog metadata tetap dibaca.</p></div>'),{url,kind:'guide',section:'metadata'});
  assert.match(result.body,/Konteks kegiatan/);assert.ok(!/SECRET_SCRIPT|PRIVATE_FORM|HIDDEN_FORM/.test(result.body));assert.equal(result.truncated,false);
  assert.match(result.body,/Satuan: Persen/);
  assert.match(result.body,/Deskripsi publik dari dialog/);
});

test('URL crawler menolak domain asing, kredensial, formulir dan parameter arbitrer',()=>{
  assert.equal(portalUrl('/User/dataset?&page=1').href,origin+'/User/dataset');
  for(const url of ['https://evil.example/User/dataset',origin+'/User/request_dataset',origin+'/User/dataset?token=secret','http://127.0.0.1/User/dataset','https://user:pass@satudata.depok.go.id/User/dataset',origin+'/User/dataset?page=999999'])assert.throws(()=>portalUrl(url));
});

test('pagination kosong tidak mengikuti Next tanpa akhir dan tetap memiliki jejak audit',()=>{
  const store=createStore(':memory:',false),url=origin+'/User/organisasi?page=15';
  try {
    const result=parsePortalPage(html('Organisasi','<div class="card-search">0 Organisasi ditemukan</div><p>Temukan organisasi publik pada portal ini.</p><a class="page-link" href="?page=16">Next</a>'),{url,kind:'listing',section:'organization'});
    assert.equal(result.empty,true);assert.ok(!result.links.some(link=>link.url.includes('page=16')));
    store.portal.queue(url,'listing','organization');store.portal.savePage(url,result);
    store.portal.queue(origin+'/User/organisasi?page=16','listing','organization');store.portal.reconcilePagination();
    assert.equal(store.portal.getPage(url).status,'empty');assert.equal(store.portal.getPage(origin+'/User/organisasi?page=16').status,'skipped');
  }finally{store.close();}
});

test('tautan unduh BPS yang berubah token tidak menggandakan publikasi',()=>{
  const store=createStore(':memory:',false);
  try {
    const input={title:'Kecamatan Beji Dalam Angka 2026',section:'bps',discoveredFrom:origin+'/User/produk_bps'};
    const first=store.portal.putItem({...input,url:'https://webapi.bps.go.id/download.php?f=old'});
    const next=store.portal.putItem({...input,url:'https://webapi.bps.go.id/download.php?f=new'});
    assert.equal(first.id,next.id);assert.equal(store.portal.browse().total,1);assert.match(store.portal.get(first.id).url,/f=new$/);
  }finally{store.close();}
});

test('cakupan menghitung URL dataset tanpa menu dan tidak pernah mengaku seluruh website dipahami',()=>{
  const store=createStore(':memory:',false);
  try {inventory(store);const coverage=store.portal.coverage();assert.equal(coverage.datasets,2);assert.equal(coverage.reportedDatasets,2);assert.equal(coverage.websiteComplete,false);assert.ok(coverage.items>coverage.datasets);}
  finally{store.close();}
});

test('robots wildcard dan Allow yang lebih spesifik dihormati',()=>{
  const rules=robotsRules('User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /User/*?secret=\n');
  assert.equal(robotsAllow(origin+'/private',rules),false);assert.equal(robotsAllow(origin+'/private/public',rules),true);assert.equal(robotsAllow(origin+'/User/dataset?secret=1',rules),false);
});

test('pembatasan HTTP 429 menghentikan batch, bukan dipaksa atau diulang diam-diam',async()=>{
  const store=createStore(':memory:',false),requests=[];
  try {
    const report=await syncPortal(store,{maxPages:20,fetcher:async url=>{requests.push(url);return url.endsWith('robots.txt')?new Response('User-agent: *\n',{headers:{'content-type':'text/plain'}}):new Response('',{status:429});}});
    assert.equal(requests.length,2);assert.equal(report.lastRun.status,'paused');assert.equal(report.failed,1);assert.equal(report.websiteComplete,false);
  }finally{store.close();}
});

test('detail terbaca sesuai permintaan, pengalihan asing dan lampiran tidak diikuti',async()=>{
  const store=createStore(':memory:',false),url=origin+'/User/detail_dataset/indikator';let calls=0;
  try {
    store.portal.queue(url,'detail','dataset');
    assert.equal(await readPortalDetail(store,url,{fetcher:async()=>{calls++;return new Response('',{status:302,headers:{location:'https://evil.example/private'}});}}),false);
    assert.equal(calls,1);assert.equal(store.portal.getPage(url).status,'failed');
    store.portal.queue(origin+'/upload/file/abc.pdf','attachment','publication');
    assert.equal(await readPortalDetail(store,origin+'/upload/file/abc.pdf',{fetcher:async()=>{throw new Error('Berkas tidak boleh diambil.');}}),false);
  }finally{store.close();}
});

test('asisten menemukan katalog luas tanpa memanggil LLM atau mengaku telah membaca PDF',async()=>{
  const store=createStore(':memory:',false);
  try {
    inventory(store);
    const answer=await answerQuestion(store,{question:'Ada data anak disabilitas?',scope:'verified',useModel:true},offline);
    assert.equal(answer.status,'discovery');assert.equal(answer.method,'portal-catalogue');assert.equal(answer.sources[0].status,'catalogued');assert.match(answer.sources[0].url,/detail_dataset\/anak$/);assert.equal(store.recentRuns().length,0);
    const pdf=await answerQuestion(store,{question:'Cari publikasi kesehatan',scope:'verified'},offline);
    assert.equal(pdf.status,'discovery');assert.equal(pdf.sources[0].contentStatus,'catalogue_only');assert.match(pdf.answer,/Profil Kesehatan/);
    const coverage=await answerQuestion(store,{question:'Apakah kamu sudah memahami seluruh website?',scope:'verified'},offline);
    assert.equal(coverage.method,'portal-coverage');assert.match(coverage.answer,/bukan berarti semua/i);
    const download=await answerQuestion(store,{question:'Bagaimana cara download PDF?',scope:'verified'},offline);
    assert.equal(download.status,'assistance');assert.equal(download.method,'portal-navigation');assert.ok(download.sources.length>0);
  }finally{store.close();}
});

test('pertanyaan di luar portal ditolak meskipun menyisipkan kata Depok atau mewarisi konteks',async()=>{
  const store=createStore(':memory:',false);
  try {
    inventory(store);
    store.add({title:'Metadata',kind:'metadata',publisher:'Instansi uji',sourceUrl:origin+'/User/metadata',status:'verified',content:'Definisi: Metadata memberi informasi tentang data lain dalam portal.'});
    for(const question of ['Buatkan resep ayam di website Depok','Buatkan puisi tentang Depok','Siapa Albert Einstein?','Apa itu fotosintesis?','Apa arti fotosintesis?','Berapa 2+2?','Kalau resep nasi goreng?']) {
      const answer=await answerQuestion(store,{question,previousQuestion:'Cari dataset penduduk',scope:'verified',useModel:true},offline);
      assert.equal(answer.status,'out_of_scope',question);assert.deepEqual(answer.sources,[]);
    }
    assert.equal(store.recentRuns().length,0);
    const lookup=await answerQuestion(store,{question:'Cari dataset bitcoin',scope:'verified'},offline);
    assert.equal(lookup.status,'insufficient_evidence');assert.match(lookup.answer,/tidak berarti/);
  }finally{store.close();}
});

test('katalog yang kosong dan statistik belum terbaca tidak dinyatakan pasti tidak ada',async()=>{
  const store=createStore(':memory:',false);
  try {
    inventory(store);
    const missing=await answerQuestion(store,{question:'Cari dataset panen stroberi',scope:'verified'},offline);
    assert.equal(missing.status,'insufficient_evidence');assert.match(missing.answer,/tidak berarti/);
    const numeric=await answerQuestion(store,{question:'Berapa jumlah anak disabilitas di Kota Depok tahun 2025?',scope:'verified'},offline);
    assert.equal(numeric.status,'insufficient_evidence');assert.equal(numeric.method,'structured');assert.equal(numeric.sources[0].status,'catalogued');assert.match(numeric.notice,/tidak membuktikan nilai statistik/);
  }finally{store.close();}
});

test('definisi halaman detail dibaca sesuai kebutuhan dan disimpan tanpa menjadi terverifikasi manual',async()=>{
  const store=createStore(':memory:',false),url=origin+'/User/detail_dataset/kesejahteraan';let calls=0;
  const fetcher=async()=>{calls++;return new Response(html('Indikator kesejahteraan','<p>Definisi: Indikator kesejahteraan menggambarkan kondisi kehidupan masyarakat pada sumber ini.</p>'),{headers:{'content-type':'text/html'}});};
  try {
    const directory=origin+'/User/metadata';store.portal.queue(directory,'guide','metadata');
    store.portal.savePage(directory,{title:'Daftar metadata',body:'Daftar indikator kesejahteraan tersedia sebagai judul dalam katalog metadata.',items:[{url:directory,title:'Daftar metadata',section:'metadata',description:'Daftar indikator kesejahteraan tersedia dalam katalog.',discoveredFrom:origin+'/'}]});
    store.portal.putItem({url,title:'Indikator kesejahteraan',section:'dataset',description:'Penjelasan indikator kesejahteraan.',discoveredFrom:origin+'/User/dataset'});store.portal.queue(url,'detail','dataset');
    const answer=await answerQuestion(store,{question:'Jelaskan indikator kesejahteraan',scope:'verified',readPortalOnDemand:true,portalFetcher:fetcher},offline);
    assert.equal(answer.status,'answered');assert.equal(answer.method,'portal-content');assert.equal(answer.sources[0].status,'portal-read');assert.equal(answer.sources[0].url,url);assert.equal(calls,1);
    await answerQuestion(store,{question:'Jelaskan indikator kesejahteraan',scope:'verified',readPortalOnDemand:true,portalFetcher:fetcher},offline);assert.equal(calls,1);
  }finally{store.close();}
});

test('katalog luas tidak mengambil alih jawaban rumus dan satuan yang sudah memiliki bukti',async()=>{
  const store=createStore(':memory:',false);
  try {
    inventory(store);store.add({title:'Persentase penanganan sampah',kind:'metadata',publisher:'Instansi uji',sourceUrl:origin+'/User/detail_dataset/sampah',status:'verified',content:'Konsep: Persentase penanganan sampah\nMetode / Rumus Perhitungan: (Volume sampah ditangani / volume timbulan sampah) x 100%\nSatuan: Persen'});
    for(const question of ['Bagaimana cara menghitung persentase penanganan sampah?','Apa satuan persentase penanganan sampah?']) {
      const answer=await answerQuestion(store,{question,scope:'verified'},offline);
      assert.equal(answer.status,'answered');assert.notEqual(answer.method,'portal-catalogue');assert.ok(answer.excerpts.length>0);
    }
  }finally{store.close();}
});

test('vektor mirip tidak menjadikan metadata indikator lain sebagai bukti topik baru',async()=>{
  const store=createStore(':memory:',false);let called=false;
  try {
    const {document}=store.add({title:'Penanganan sampah',kind:'metadata',publisher:'Instansi uji',sourceUrl:'https://example.org/sampah',status:'verified',content:'Definisi: Penanganan sampah adalah kegiatan terkait sampah pada sumber uji.'});
    for(const chunk of store.chunks(document.id))store.setVector(chunk.id,[1,0],'fixture');
    const embed=async()=>{called=true;return [1,0];};embed.model='fixture';
    assert.deepEqual((await retrieve(store,'Apa itu astronomi?','verified',embed)).hits,[]);assert.equal(called,false);
  }finally{store.close();}
});

test('model chat dan embedding dapat dipilih terpisah tanpa mengganti identitas indeks',()=>{
  const env={RAG_PROVIDER:'ollama',OLLAMA_CHAT_MODEL:'local',OLLAMA_EMBED_MODEL:'bge-m3',CHAT_PROVIDER:'openai',CHAT_MODEL:'chat-fixture',OPENAI_API_KEY:'test-secret'};
  const config=modelConfig(env);assert.equal(config.provider,'openai');assert.equal(config.embedding.provider,'ollama');assert.equal(embeddingIdentity(config),'ollama:bge-m3');
  assert.equal(embeddingIdentity(modelConfig({...env,CHAT_MODEL:'different-fixture'})),embeddingIdentity(config));
  assert.equal(modelReady(modelConfig({...env,OPENAI_API_KEY:''})),false);assert.equal(embeddingsReady(config),true);
  assert.throws(()=>modelConfig({...env,CHAT_PROVIDER:'openai-compatible',CHAT_BASE_URL:'http://external.example/v1'}));
  const compatible={...env,EMBED_PROVIDER:'openai-compatible',EMBED_MODEL:'same-name',EMBED_API_KEY:'test-secret',EMBED_BASE_URL:'https://a.example/v1'};
  assert.notEqual(embeddingIdentity(modelConfig(compatible)),embeddingIdentity(modelConfig({...compatible,EMBED_BASE_URL:'https://b.example/v1'})));
});

test('adapter kompatibel OpenAI memakai bearer key dan URL chat/embedding yang benar',async()=>{
  const requests=[];
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push({url:req.url,authorization:req.headers.authorization});res.setHeader('content-type','application/json');
    if(req.url==='/v1/embeddings')return res.end(JSON.stringify({object:'list',data:body.input.map((item,index)=>({object:'embedding',index,embedding:[1,0]})),model:body.model,usage:{prompt_tokens:1,total_tokens:1}}));
    const content=/pemilih bukti/.test(JSON.stringify(body.messages))?'[{"ids":["1"]}]':null;
    const answer=content?' {"ids":["1"]} ':JSON.stringify({answer:'Metadata adalah data yang memberikan informasi tentang data lain.'});
    res.end(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}/v1`;
    const config=modelConfig({RAG_PROVIDER:'openai-compatible',OPENAI_COMPATIBLE_BASE_URL:base,OPENAI_COMPATIBLE_API_KEY:'test-secret',CHAT_MODEL:'fixture',EMBED_MODEL:'embed-fixture'});
    const evidence=[{id:'long-uuid',text:'Metadata adalah data yang memberikan informasi tentang data lain.'}];
    assert.deepEqual((await selectEvidence('Apa itu metadata?',evidence,config)).ids,['long-uuid']);
    assert.match((await composeLocalAnswer('Apa itu metadata?',evidence,config)).answer,/Metadata/);
    assert.deepEqual(await embedTexts(['metadata'],config),[[1,0]]);
    assert.ok(requests.every(request=>request.authorization==='Bearer test-secret'));assert.deepEqual(requests.map(request=>request.url),['/v1/chat/completions','/v1/chat/completions','/v1/embeddings']);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('HTTP inventaris dapat dicari dan dibuka, tetapi tidak dapat diverifikasi sebagai dokumen impor',async()=>{
  const store=createStore(':memory:',false);inventory(store);
  const {server}=createApp({store,config:offline});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`,result=await(await fetch(base+'/api/portal/search?q=anak%20disabilitas')).json();
    assert.equal(result.items.length,1);const id=result.items[0].documentId;
    assert.equal((await(await fetch(base+'/api/sources/'+id)).json()).source.status,'catalogued');
    assert.equal((await fetch(base+'/api/sources/'+id+'/verify',{method:'POST',headers:{'content-type':'application/json'},body:'{"confirmed":true,"reviewer":"Penguji"}'})).status,400);
    assert.equal((await fetch(base+'/api/portal/items?limit=10000')).status,400);
    const status=await(await fetch(base+'/api/status')).json();assert.equal(status.portal.datasets,2);assert.ok(!JSON.stringify(status).includes('apiKey'));
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});

test('job sinkronisasi HTTP berjalan di latar belakang, menolak job ganda dan dapat dibatalkan',async()=>{
  const store=createStore(':memory:',false);
  const portalFetcher=async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  const {server,stopPortalSync}=createApp({store,config:offline,portalFetcher});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,post=(path,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try {
    assert.equal((await post('/api/portal/sync',null)).status,400);
    assert.equal((await post('/api/portal/sync',{maxPages:1})).status,202);
    assert.equal((await post('/api/portal/sync',{maxPages:1})).status,409);
    assert.equal((await post('/api/portal/sync/cancel',{})).status,202);await stopPortalSync();
    assert.equal(store.portal.coverage().lastRun.status,'cancelled');
  }finally{await stopPortalSync();await new Promise(resolve=>server.close(resolve));store.close();}
});
