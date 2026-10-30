import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.js';
import {createApp} from '../server/index.js';
import {PORTAL_ORIGIN,syncPortal} from '../server/portal-sync.js';
import {syncAttachments} from '../server/attachments.js';
import {portalContentAnswer} from '../server/portal-chat.js';
import {fixturePdf} from './fixtures.js';

const origin=PORTAL_ORIGIN;
const offline={provider:'openai',apiKey:'',chatModel:'fixture',embeddingModel:'',baseUrl:'https://api.openai.com/v1'};
const html=(title,body)=>`<html><head><title>${title}</title></head><body><div class="section-page"><div class="hero-section"><h2>${title}</h2></div></div>${body}</body></html>`;
const pdfUrl=origin+'/upload/file/profil-kesehatan.pdf';
const pdf=fetcherReply=>fixturePdf('Profil kesehatan Kota Depok 2025 indikator sampah dan stunting');

function portalFetcher(requests,{onAttachment}={}) {
  return async url=>{
    requests.push(url);
    if(url.endsWith('/robots.txt'))return new Response('User-agent: *\n',{headers:{'content-type':'text/plain'}});
    if(url.endsWith('.pdf'))return onAttachment ? onAttachment(url) : new Response(pdf(),{headers:{'content-type':'application/pdf'}});
    return new Response(html('Halaman uji','<p>Halaman publik untuk pengujian sinkronisasi portal dan lampiran.</p>'),{headers:{'content-type':'text/html'}});
  };
}

test('lampiran PDF diekstrak, dicari, dan tidak diunduh ulang pada batch berikutnya',async()=>{
  const store=createStore(':memory:',false),requests=[];
  try {
    store.portal.queue(pdfUrl,'attachment','publication');
    store.portal.putItem({url:pdfUrl,title:'Profil Kesehatan Kota Depok Tahun 2025',section:'publication',format:'PDF',description:'Publikasi kesehatan, isi belum diekstrak.',discoveredFrom:origin+'/User/produk_bidangstatistik'});
    const fetcher=portalFetcher(requests);
    const report=await syncPortal(store,{maxPages:1,fetcher,includeAttachments:true,maxAttachments:1,delayMs:500});
    const page=store.portal.getPage(pdfUrl);
    assert.equal(page.status,'fetched');assert.match(page.body,/Profil kesehatan/);assert.equal(page.extractor,'PDF · 1 halaman');assert.ok(page.bytes>100);
    assert.equal(report.readAttachments,1);assert.equal(report.unreadAttachments,0);
    const card=store.portal.card(store.portal.getByUrl(pdfUrl));
    assert.equal(card.status,'attachment-read');assert.equal(card.contentStatus,'attachment_read');
    const found=store.portal.readSearch('profil kesehatan');
    assert.equal(found[0].url,pdfUrl);assert.match(found[0].body,/Profil kesehatan/);
    const answer=await portalContentAnswer(store,'Apa isi profil kesehatan?',{});
    assert.equal(answer.method,'portal-content');assert.equal(answer.sources[0].status,'attachment-read');assert.match(answer.notice,/lampiran PDF\/XLSX/);

    const before=requests.filter(url=>url===pdfUrl).length;
    await syncPortal(store,{maxPages:1,fetcher,includeAttachments:true,maxAttachments:1,delayMs:500});
    assert.equal(requests.filter(url=>url===pdfUrl).length,before);
  } finally {store.close();}
});

test('lampiran yang tidak didukung dilewati tanpa permintaan jaringan',async()=>{
  const store=createStore(':memory:',false),url=origin+'/upload/file/data-lama.xls';
  try {
    store.portal.queue(url,'attachment','publication');
    store.portal.putItem({url,title:'Data lama',section:'publication',format:'XLSX',description:'Berkas lama.',discoveredFrom:origin+'/User/dataset'});
    const result=await syncAttachments(store,{fetcher:async()=>{throw new Error('Tidak boleh diambil.');},maxAttachments:1});
    assert.equal(result.processed,1);assert.equal(result.failed,1);
    const page=store.portal.getPage(url);
    assert.equal(page.status,'skipped');assert.match(page.error,/\.xls|hanya PDF dan XLSX/);
    assert.equal(store.portal.coverage().skippedAttachments,1);assert.equal(store.portal.card(store.portal.getByUrl(url)).status,'catalogued');
  } finally {store.close();}
});

test('halaman HTML dan pengalihan dicatat dibatasi, bukan diekstrak sebagai PDF',async()=>{
  const store=createStore(':memory:',false),blocked=origin+'/upload/file/rusak.pdf',moved=origin+'/upload/file/pindah.pdf';
  try {
    for(const url of [blocked,moved])store.portal.queue(url,'attachment','publication');
    const fetcher=async url=>url===blocked
      ?new Response('<html>Request Rejected</html>',{headers:{'content-type':'application/pdf'}})
      :new Response('',{status:302,headers:{location:'https://evil.example/berkas.pdf'}});
    const result=await syncAttachments(store,{fetcher,maxAttachments:2,delayMs:500});
    assert.equal(result.processed,2);assert.equal(result.failed,2);
    assert.equal(store.portal.getPage(blocked).status,'blocked');assert.match(store.portal.getPage(blocked).error,/HTML/);
    assert.equal(store.portal.getPage(moved).status,'blocked');assert.match(store.portal.getPage(moved).error,/Pengalihan/);
    assert.equal(store.portal.coverage().readAttachments,0);
  } finally {store.close();}
});

test('robots.txt melarang lampiran tanpa mencoba mengunduh',async()=>{
  const store=createStore(':memory:',false);
  try {
    store.portal.queue(pdfUrl,'attachment','publication');
    const result=await syncAttachments(store,{fetcher:async()=>{throw new Error('Tidak boleh diambil.');},maxAttachments:1,rules:[{allow:false,path:'/upload'}]});
    assert.equal(result.failed,1);assert.equal(store.portal.getPage(pdfUrl).status,'blocked');assert.match(store.portal.getPage(pdfUrl).error,/robots/);
  } finally {store.close();}
});

test('teks terpotong disimpan sebagian dan tidak masuk indeks pencarian',()=>{
  const store=createStore(':memory:',false),url=origin+'/upload/file/besar.pdf';
  try {
    store.portal.queue(url,'attachment','publication');
    store.portal.saveAttachment(url,{format:'pdf',text:'Isi lampiran yang sangat panjang',truncated:true,detail:{pages:900}});
    const page=store.portal.getPage(url);
    assert.equal(page.status,'partial');assert.equal(page.extractor,'PDF · 900 halaman');assert.match(page.error,/dipotong/);
    assert.equal(store.db.prepare('SELECT count(*) AS total FROM portal_pages_fts WHERE url=?').get(url).total,0);
    assert.equal(store.portal.card(store.portal.getByUrl(url) || {url}).contentStatus,'attachment_partial');
  } finally {store.close();}
});

test('HTTP menolak batas lampiran yang tidak valid sebelum memulai job',async()=>{
  const store=createStore(':memory:',false),{server}=createApp({store,config:offline});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,post=body=>fetch(base+'/api/portal/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try {
    assert.equal((await post({maxPages:1,maxAttachments:0})).status,400);
    assert.equal((await post({maxPages:1,maxAttachments:21})).status,400);
    assert.equal((await post({maxPages:1,includeAttachments:'ya'})).status,400);
    assert.equal((await post({maxPages:151})).status,400);
  } finally {await new Promise(resolve=>server.close(resolve));store.close();}
});
