import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { parseObservations } from './import.js';

export class PublicSourceError extends Error { constructor(message,code='invalid_source') {super(message);this.code=code;} }
const clean=value=>value.replace(/\s+/g,' ').trim();
const validUrl=value=>{const url=new URL(value);if(url.protocol!=='https:' || url.hostname!=='satudata.depok.go.id' || !(url.pathname==='/User/metadata' || /^\/User\/detail_dataset\/[a-z0-9-]+$/.test(url.pathname)) || url.username || url.password || url.search)throw new PublicSourceError('URL tidak termasuk halaman metadata publik yang diizinkan.');return url;};

export function parsePublicMetadata(html,url) {
  validUrl(url);
  if (/Request Rejected|requested URL was rejected|captcha|access denied/i.test(html.slice(0,1200))) throw new PublicSourceError('Akses sumber ditolak; pengambilan dihentikan tanpa melewati proteksi.','access_rejected');
  const $=load(html);
  if(new URL(url).pathname==='/User/metadata') {
    const title=clean($('.section-page .hero-section h2').first().text()),definition=clean($('.section-page .hero-section .heading-part>p').first().text());
    const kinds=$('section.metadata ul.nav li').map((i,el)=>`${clean($(el).find('h4').text())}: ${clean($(el).find('p').text())}`).get().slice(0,3);
    if(title!=='Metadata Satu Data Depok' || !definition.startsWith('Metadata adalah') || kinds.length!==3)throw new PublicSourceError('Halaman pengertian metadata berubah struktur.');
    return {title,publisher:'Portal Satu Data Kota Depok',sourceUrl:url,kind:'metadata',status:'unverified',description:'Penjelasan pengertian metadata dan jenis metadata pada halaman publik portal.',content:[title,definition,...kinds].join('\n\n'),year:null,region:null,fields:{},resourceIds:[],sourceUpdatedAt:null};
  }
  $('script,style,nav,footer,form').remove();
  const title=clean($('.section-page .hero-section h2').first().text());
  const publisher=clean($('.section-page .dinas h6').first().text());
  if(title.length<8 || !publisher || !$('#nav-tabContent').length)throw new PublicSourceError('Struktur halaman tidak sesuai parser metadata.');
  const sections=[],fields={};
  $('#nav-tabContent .tab-pane').each((i,element)=>{
    const section=$(element),heading=clean(section.find('h5').first().text());
    const rows=[];
    section.find('table tr').each((j,row)=>{
      const key=clean($(row).find('th').first().text());
      const value=clean($(row).find('td').first().text());
      if(key && value && value!=='-') {rows.push(`${key}: ${value}`);fields[key]=value;}
    });
    if(!section.find('table').length) {
      const description=clean(section.find('p').map((i,p)=>$(p).text()).get().join(' '));
      if(description && description!=='-') rows.push(description);
    }
    if(heading && rows.length)sections.push(`${heading}\n${rows.join('\n')}`);
  });
  if(!sections.length || !fields['Nama Indikator'] && !fields['Nama Variabel'])throw new PublicSourceError('Metadata substantif tidak ditemukan; halaman tidak dimasukkan sebagai bukti.');
  const content=[`Dataset: ${title}`,`Produsen pada halaman: ${publisher}`,'Jenis materi: metadata dataset. Nilai observasi statistik belum diambil dari tabel sumber.',...sections].join('\n\n');
  const resourceIds=$('.preview-btn[data-id]').map((i,e)=>$(e).attr('data-id')).get().filter(id=>/^[a-z0-9-]+$/.test(id));
  return {title,publisher,sourceUrl:url,kind:'metadata',status:'unverified',description:`Metadata publik ${title}. Tabel nilai observasi belum diimpor.`,content,year:null,region:null,fields,resourceIds,sourceUpdatedAt:fields['Dataset Diperbarui'] || null};
}

async function publicHtml(url,fetcher) {
  let target=validUrl(url);
  for(let redirects=0;redirects<3;redirects++) {
    const response=await fetcher(target.href,{signal:AbortSignal.timeout(15000),redirect:'manual'});
    if([301,302,303,307,308].includes(response.status)) {target=validUrl(new URL(response.headers.get('location'),target).href);continue;}
    if(!response.ok)throw new PublicSourceError(`Sumber merespons HTTP ${response.status}.`,'http_error');
    if(!/text\/html/i.test(response.headers.get('content-type') || ''))throw new PublicSourceError('Sumber bukan HTML.');
    let html='',size=0;const decoder=new TextDecoder(),limit=target.pathname==='/User/metadata'?2_500_000:1_500_000;
    for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new PublicSourceError('Halaman melampaui batas ukuran.');html+=decoder.decode(chunk,{stream:true});}
    return html+decoder.decode();
  }
  throw new PublicSourceError('Terlalu banyak pengalihan URL.');
}

export async function curatedSources() {return (JSON.parse(await readFile('data/public-sources.json','utf8'))).sources;}
export async function syncPublicSources(store,{fetcher=fetch,entries,rawDirectory='data/raw'}={}) {
  entries ||= await curatedSources();
  if(entries.length>8)throw new PublicSourceError('Maksimal delapan sumber terkurasi per pengambilan.');
  const results=[];await mkdir(rawDirectory,{recursive:true});
  for(const entry of entries) {
    try {
      const html=await publicHtml(entry.url,fetcher),metadata=parsePublicMetadata(html,entry.url);
      const rawHash=createHash('sha256').update(html).digest('hex');
      const filename=`${entry.key}-${rawHash.slice(0,16)}.html`;
      await writeFile(join(rawDirectory,filename),html,'utf8');
      const {fields,resourceIds,...document}=metadata;
      document.provenance=JSON.stringify({method:'curated_public_html',parserVersion:1,rawHash,rawFile:filename,resourceIds,fields});
      const result=store.add(document);
      results.push({key:entry.key,id:result.document.id,title:result.document.title,hash:result.document.hash,status:result.document.status,duplicate:result.duplicate,sourceUpdatedAt:metadata.sourceUpdatedAt,rawFile:filename});
    } catch(error) {results.push({key:entry.key,error:error instanceof PublicSourceError?error.message:'Pengambilan sumber gagal; periksa koneksi.',code:error.code || 'fetch_failed'});}
    if(entries.indexOf(entry)<entries.length-1)await new Promise(resolve=>setTimeout(resolve,400));
  }
  return results;
}

export function normalizeDepokCsv(csv,{indicator}={}) {
  if(!indicator)throw new PublicSourceError('Nama indikator terverifikasi diperlukan untuk normalisasi CSV.');
  let records;
  try{records=parse(csv,{delimiter:';',columns:headers=>headers.map(header=>header.trim()),skip_empty_lines:true,bom:true,trim:true});}catch{throw new PublicSourceError('CSV publik tidak sesuai format yang diperiksa.');}
  const fields=['nama_kabupaten_kota','nama_instansi','nama_data','hasil','Tahun','Satuan'];
  if(!records.length || records.length>5000 || fields.some(field=>!(field in records[0])))throw new PublicSourceError('Kolom CSV publik tidak sesuai parser.');
  const quote=value=>`"${String(value).replaceAll('"','""')}"`;
  const lines=records.map((row,index)=>{
    if(fields.some(field=>!row[field]) || !/^-?\d+(?:,\d+)?$/.test(row.hasil) || row.nama_kabupaten_kota!=='Kota Depok' || row.Satuan.toLowerCase()!=='persen')throw new PublicSourceError(`CSV baris ${index+2} memiliki nilai, wilayah, atau satuan yang perlu pemeriksaan manual.`);
    return [indicator,row.Tahun,row.nama_kabupaten_kota,row.hasil.replace(',','.'),row.Satuan].map(quote).join(',');
  });
  const normalized=`indicator,year,region,value,unit\n${lines.join('\n')}\n`;
  return {content:normalized,observations:parseObservations(normalized),originalRecords:records};
}

export async function importPublicWasteCsv(store,{fetcher=fetch,rawDirectory='data/raw'}={}) {
  // A single publicly advertised resource, the same endpoint used by the site's Preview button.
  const resourceId='294ce4d4-4cfc-41e1-ae15-863e5915f61f';
  const endpoint=`https://satudata.depok.go.id/User/get_detail_reource/${resourceId}`;
  const response=await fetcher(endpoint,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw new PublicSourceError('Informasi berkas publik tidak dapat diperoleh.');
  let resource;try{resource=await response.json();}catch{throw new PublicSourceError('Informasi berkas bukan JSON publik yang valid.');}
  if(String(resource.info?.private)!=='0' || resource.dataset?.state!=='active' || resource.dataset?.format?.toLowerCase()!=='csv')throw new PublicSourceError('Resource tidak ditandai publik/aktif/CSV.');
  const url=new URL(resource.dataset.url);
  if(url.protocol!=='https:' || url.hostname!=='satudata.depok.go.id' || !/^\/uploads\/dataset\/[^/]+\.csv$/i.test(url.pathname) || url.search)throw new PublicSourceError('Lokasi unduhan CSV tidak termasuk sumber yang diperiksa.');
  const file=await fetcher(url.href,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!file.ok)throw new PublicSourceError('Berkas CSV publik tidak dapat diunduh.');
  const size=Number(file.headers.get('content-length'));if(size>500000)throw new PublicSourceError('Berkas melampaui batas ukuran.');
  const text=await file.text();if(Buffer.byteLength(text)>500000)throw new PublicSourceError('Berkas melampaui batas ukuran.');
  if(/Request Rejected|<html/i.test(text))throw new PublicSourceError('Unduhan ditolak atau bukan CSV.');
  const normalized=normalizeDepokCsv(text,{indicator:'Persentase penanganan sampah'});
  const hash=createHash('sha256').update(text).digest('hex');
  const filename=`penanganan-sampah-${hash.slice(0,16)}.csv`;await mkdir(rawDirectory,{recursive:true});await writeFile(join(rawDirectory,filename),text,'utf8');
  const result=store.add({title:'Persentase penanganan sampah Kota Depok — observasi publik',publisher:resource.info.org,sourceUrl:url.href,kind:'csv',status:'unverified',region:'Kota Depok',unit:'persen',filename,description:'Observasi tahunan dari CSV publik. Nilai diperiksa terhadap berkas asli sebelum digunakan.',content:normalized.content,sourceUpdatedAt:resource.dataset.metadata_modified,provenance:JSON.stringify({method:'curated_public_csv',resourceEndpoint:endpoint,resourceId,rawFile:filename,rawHash:hash,originalIndicator:resource.info.title,indicatorAliasSource:'Konsep pada metadata indikator: Persentase penanganan sampah',normalization:'Pemisah titik koma; koma desimal menjadi titik; urutan/baris sumber dipertahankan.'})},normalized.observations);
  return {id:result.document.id,hash:result.document.hash,status:result.document.status,title:result.document.title,duplicate:result.duplicate,rows:normalized.observations.length,rawFile:filename};
}
