import {rankSentences,tokens} from './retrieval.js';
import {portalTerms} from './portal-store.js';
import {PORTAL_ORIGIN,PORTAL_SECTIONS,readPortalDetail} from './portal-sync.js';
import {composeLocalAnswer} from './grounding.js';
import {modelReady} from './model.js';

const unrelated=[
  /\b(?:resep|masak|memasak|zodiak|horoskop|ramalan|bitcoin|kripto|taruhan|judi)\b/i,
  /(?:buat(?:kan)?|tulis(?:kan)?|bikin(?:kan)?)\s+(?:saya\s+)?(?:puisi|pantun|cerpen|lagu|kode|program|skrip|script)\b/i,
  /\b(?:debug|javascript|python|typescript|html|css)\b.*\b(?:kode|program|error|belajar)\b/i,
  /\b(?:siapa|ceritakan|jelaskan)\b.*\b(?:einstein|naruto|ronaldo|messi|presiden amerika)\b/i,
  /\b(?:obat apa|diagnosis saya|diagnosa saya|saya harus minum obat)\b/i,
  /^\s*(?:berapa|hitung(?:kan)?)\s+\d+\s*[+*/=]/i,
];
export const isOutsidePortal=question=>{
  const catalogueIntent=/\b(?:dataset|publikasi|infografis|katalog|statistik)\b|\b(?:ada|cari(?:kan)?)\b.*\bdata\b/i.test(question);
  return unrelated.some((pattern,index)=>(index!==0 || !catalogueIntent) && pattern.test(question));
};
export const outsidePortalAnswer=()=>({status:'out_of_scope',answer:'Maaf, saya khusus membantu pencarian dan pemahaman informasi pada Portal Satu Data Depok. Saya tidak menjawab tugas umum di luar portal. Saya dapat membantu menemukan dataset, publikasi, infografis, organisasi, atau panduan portal yang kamu butuhkan.',sources:[],method:'scope-guard'});
export const hasPortalContext=question=>/data|statistik|dataset|publikasi|portal|website|situs|depok|kelurahan|kecamatan|metadata|indikator|satuan|penduduk|kesehatan|pendidikan|sampah|kemiskinan|stunting|tenaga kerja|pengangguran|inflasi|lingkungan|pdrb|organisasi|infografis|dashboard|kode referensi|\bcsv\b|\bpdf\b|\bxlsx?\b|excel|unduh|download|pratinjau|pencarian/i.test(question);
export function hasTopicEvidence(question,candidates) {
  const generic=new Set(['definisi','arti','maksud','rumus','metode','perhitungan','makna','perbedaan','bedanya']);
  const topics=portalTerms(question).filter(term=>!generic.has(term));
  return topics.length>0 && candidates.some(item=>topics.some(term=>tokens(`${item.title} ${item.description || ''} ${item.text || ''}`).includes(term)));
}

export function coverageSummary(store) {
  const value=store.portal.coverage();
  return {items:value.items,datasets:value.datasets,reportedDatasets:value.reportedDatasets,readPages:value.contentPages,
    failed:value.failed+value.blocked,partial:value.partial,unreadAttachments:value.unreadAttachments,websiteComplete:false,
    lastSyncAt:value.lastRun?.finishedAt || value.lastRun?.startedAt || null};
}
const sectionNames={dataset:'Dataset',publication:'Produk Sektoral',bps:'Produk BPS',infographic:'Infografis',insight:'Data Insight',organization:'Organisasi',category:'Kategori',gallery:'Galeri'};
function navigationSources(store,sections) {
  return sections.map(section=>PORTAL_SECTIONS.find(item=>item[0]===section))
    .filter(Boolean).map(section=>store.portal.getByUrl(PORTAL_ORIGIN+section[1])).filter(Boolean).map(item=>store.portal.card(item));
}
function preferredSections(question) {
  if(/infografis/i.test(question))return ['infographic'];
  if(/dashboard|visualisasi|data insight/i.test(question))return ['insight'];
  if(/publikasi|buku|produk sektoral|laporan/i.test(question))return /\bbps\b/i.test(question)?['bps']:['publication','bps'];
  if(/organisasi|instansi apa|dinas apa/i.test(question))return ['organization'];
  if(/kategori/i.test(question))return ['category'];
  return [];
}
export function findPortalItems(store,question,limit=6) {
  const sections=preferredSections(question);
  return sections.length?sections.flatMap(section=>store.portal.search(question,{section,limit})).slice(0,limit):store.portal.search(question,{limit});
}
function catalogueResponse(store,question,items) {
  const sources=items.map(item=>store.portal.card(item));
  const lines=items.map((item,index)=>`${index+1}. ${item.title}${item.publisher?` — ${item.publisher}`:''} (${sectionNames[item.section] || 'Halaman portal'}${item.format!=='HTML'?`, ${item.format}`:''}) [${index+1}]`);
  return {status:'discovery',answer:`Saya menemukan entri terkait pada indeks Portal Satu Data Depok:\n\n${lines.join('\n')}\n\nBuka kartu sumber untuk menuju halaman aslinya. Jika perlu, sebutkan tahun, wilayah, atau jenis publikasi agar pencarian lebih spesifik.`,sources,method:'portal-catalogue',
    notice:'Tercatat di katalog tidak berarti seluruh isi berkas sudah dibaca. Periode pada katalog bukan otomatis tahun observasi. Hasil pencarian ini bukan klaim seluruh website sudah tercakup.'};
}
export function portalNavigation(store,question,{numeric=false,definition=false}={}) {
  if(!store.portal || !store.portal.coverage().items)return null;
  if(/(?:cara|bagaimana|gimana).*(?:unduh|download|pratinjau)/i.test(question)) {
    const related=findPortalItems(store,question,4);
    return {status:'assistance',answer:'Buka halaman dataset atau publikasi yang sesuai, lalu periksa pilihan pratinjau atau unduh yang disediakan sumber tersebut. Format dan ketersediaannya bisa berbeda. Sebutkan topik, tahun, atau wilayah agar saya dapat mengarahkan ke sumber yang tepat; saya tidak membuat tautan unduh yang tidak ditemukan di portal.',sources:related.length?related.map(item=>store.portal.card(item)):navigationSources(store,['dataset','publication']),method:'portal-navigation'};
  }
  if(/cakupan|terindeks|(?:kamu|asisten).*(?:tahu|paham|memahami|mengerti|menguasai).*(?:semua|seluruh)|(?:semua|seluruh).*(?:sudah dibaca|sudah dipahami)|(?:berapa|jumlah).*(?:dataset|sumber|katalog).*(?:portal|website|indeks)/i.test(question)) {
    const value=coverageSummary(store);
    return {status:'assistance',answer:`Indeks lokal saat ini mencatat ${value.datasets} entri dataset${value.reportedDatasets?`; label katalog portal yang terakhir dibaca menyebut ${value.reportedDatasets} dataset`:''}. Ada ${value.items} entri navigasi dan sumber keseluruhan. Ini bukan berarti semua isinya sudah dipahami: ${value.unreadAttachments} lampiran belum diekstrak, ${value.partial} halaman terbaca sebagian, dan ${value.failed} halaman gagal atau dibatasi. Saya hanya menjawab berdasarkan bukti yang tersedia.`,sources:navigationSources(store,['dataset']),method:'portal-coverage'};
  }
  if(/apa.*(?:ada|bisa|fitur).*(?:website|portal|situs)|(?:menu|halaman|fitur).*(?:apa|saja)|(?:cara|bagaimana).*(?:menggunakan|pakai).*(?:portal|website)|kamu bisa apa/i.test(question)) {
    return {status:'assistance',answer:'Saya membantu menelusuri Portal Satu Data Depok: mencari dataset, publikasi, infografis, dashboard, organisasi, kategori, serta panduan metadata dan standar data. Ceritakan topik yang kamu butuhkan; jika belum jelas saya bantu mempersempit tahun atau wilayah. Saya tidak menjawab topik umum di luar portal.',sources:navigationSources(store,['dataset','publication','organization','category','metadata','insight']),method:'portal-navigation'};
  }
  if(numeric)return null;
  const explicit=/cari|carikan|temukan|ada.*(?:data|publikasi|buku|laporan)|dataset|publikasi|infografis|dashboard|buku|laporan|di mana|dimana|butuh|ingin tahu|mau tahu|ingin lihat/i.test(question);
  if(definition && !/cari|carikan|temukan|di mana|dimana/i.test(question))return null;
  if(!explicit && !/^(?:data|kesehatan|pendidikan|kependudukan|kemiskinan|stunting)\b/i.test(question) && !store.portal.search(question,{limit:1}).length)return null;
  const terms=portalTerms(question);
  if(!terms.length)return {status:'clarify',answer:'Topik apa yang ingin kamu cari di Portal Satu Data Depok? Misalnya pendidikan, kesehatan, penduduk, atau lingkungan. Sebutkan tahun dan wilayah jika sudah diketahui.',sources:navigationSources(store,['dataset','publication']),method:'portal-navigation'};
  const items=findPortalItems(store,question);
  if(items.length)return catalogueResponse(store,question,items);
  return portalNotFound(store);
}
export function portalNotFound(store,question='') {
  const related=question?findPortalItems(store,question,4):[];
  if(related.length)return {status:'insufficient_evidence',answer:'Ada entri katalog yang terkait dengan pertanyaanmu, tetapi isi yang sudah berhasil dibaca belum cukup untuk menjawabnya. Saya tidak menyimpulkan isi PDF, gambar, atau angka hanya dari judul. Buka kartu berikut untuk memeriksa sumber asli.',sources:related.map(item=>store.portal.card(item)),method:'portal-catalogue',notice:'Tercatat dalam katalog bukan berarti isi sudah dibaca atau ditinjau.'};
  return {status:'insufficient_evidence',answer:'Saya belum menemukan kecocokan dalam indeks Portal Satu Data Depok yang tersedia saat ini. Ini tidak berarti datanya pasti tidak ada di website. Coba sebutkan nama indikator, organisasi, wilayah, atau tahun; kamu juga dapat membuka katalog asli melalui kartu berikut.',sources:navigationSources(store,['dataset','publication']),method:'portal-catalogue',notice:'Indeks dan pembacaan isi belum mencakup seluruh portal. Sumber yang gagal atau belum dibaca tidak dipakai untuk mengarang jawaban.'};
}

export async function portalContentAnswer(store,question,{useModel=false,config,readOnDemand=false,fetcher=fetch}={}) {
  const started=performance.now();
  let pages=store.portal.readSearch(question);
  if(readOnDemand) {
    const item=findPortalItems(store,question,3)[0];
    if(item && store.portal.getPage(item.url)?.kind==='detail') {
      // A large metadata directory may mention the same title without its
      // definition. Prefer the actual matched detail, not that incidental hit.
      if(!await readPortalDetail(store,item.url,{fetcher}))return null;
      pages=[store.portal.getPage(item.url)];
    }
  }
  if(!pages.length)return null;
  const hits=pages.map(page=>({id:page.url,documentId:store.portal.getByUrl(page.url)?.id,text:page.body,title:page.title,page}));
  const sentences=rankSentences(hits,question).filter(item=>item.text.length<=800).slice(0,3);
  if(!sentences.length)return null;
  const used=[...new Map(sentences.map(item=>[item.source.page.url,item.source.page])).values()];
  const sources=used.map(page=>store.portal.card(store.portal.getByUrl(page.url)));
  let answer='Berikut bagian halaman portal yang sesuai dengan pertanyaanmu. Periksa konteks lengkap melalui kartu sumber.',mode='extractive';
  let notice='Kutipan diambil dari halaman publik yang berhasil dibaca otomatis; bukan pengesahan atau hasil peninjauan manual terhadap semua isinya.';
  if(useModel && config && modelReady(config)) {
    try {
      const composed=await composeLocalAnswer(question,sentences,config);
      answer=`${composed.answer} ${sources.map((source,index)=>`[${index+1}]`).join(' ')}`;mode='generated';
      store.logRun({provider:config.provider,model:config.chatModel,status:'success',...composed.usage,elapsedMs:Math.round(performance.now()-started)});
    } catch {notice+=' Model tidak dapat menyusun kalimat yang lolos pemeriksaan; yang ditampilkan adalah kutipan halaman.';}
  }
  if(used.some(page=>store.portal.getPage(page.url)?.hash!==page.hash || store.portal.getPage(page.url)?.status!=='fetched'))return portalNotFound(store);
  return {status:'answered',answer,sources,excerpts:sentences.map(item=>({text:item.text,sourceIndex:used.findIndex(page=>page.url===item.source.page.url)+1})),mode,method:'portal-content',notice,...(mode==='generated'?{provider:config.provider,model:config.chatModel}:{})};
}

export function portalSuggestionsForNumber(store,question) {
  const items=findPortalItems(store,question,4);
  return items.length?{sources:items.map(item=>store.portal.card(item)),notice:'Ada entri katalog terkait, tetapi judul, periode katalog, dan tanggal pembaruan tidak membuktikan nilai statistik. Buka sumber asli atau tambahkan tabel yang sudah ditinjau.'}:null;
}
