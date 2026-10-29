import {load} from 'cheerio';
import {setTimeout as delay} from 'node:timers/promises';

export const PORTAL_ORIGIN='https://satudata.depok.go.id';
export const PORTAL_SECTIONS=[
  ['home','/','Beranda','guide'],['profile','/User/profil','Tentang portal','guide'],
  ['standard','/User/standardata','Standar Data','guide'],['metadata','/User/metadata','Metadata','guide'],
  ['interoperability','/User/interoperabilitas','Interoperabilitas','guide'],['reference','/User/kodereferensi','Kode Referensi','guide'],
  ['dataset','/User/dataset','Dataset','listing'],['category','/User/grup','Kategori','listing'],
  ['organization','/User/organisasi','Organisasi','listing'],['publication','/User/produk_bidangstatistik','Produk Sektoral','listing'],
  ['bps','/User/produk_bps','Produk BPS','listing'],['infographic','/User/infografis','Infografis','listing'],
  ['insight','/User/datainsight','Data Insight','listing'],['gallery','/User/galeri','Galeri','listing'],
];
const clean=value=>String(value || '').replace(/\s+/g,' ').trim();
export class PortalSyncError extends Error {constructor(message,code='fetch_failed'){super(message);this.code=code;}}

export function portalUrl(input,base=PORTAL_ORIGIN) {
  const url=new URL(input,base);
  if(url.origin!==PORTAL_ORIGIN || url.username || url.password)throw new PortalSyncError('URL di luar domain portal.','invalid_url');
  const known=PORTAL_SECTIONS.some(section=>section[1]===url.pathname);
  const detail=/^\/User\/(?:detail_dataset|data_organisasi|data_grup)\/[a-z0-9-]+$/i.test(url.pathname) || /^\/User\/datainsightDetail\/\d+$/.test(url.pathname);
  const attachment=/^\/upload\/(?:(?:file|gallery)\/)?[a-zA-Z0-9_.-]+\.(?:pdf|csv|xlsx?|png|jpe?g|webp)$/i.test(url.pathname);
  if(!known && !detail && !attachment)throw new PortalSyncError('Rute belum diizinkan untuk pengambilan otomatis.','unsupported_route');
  const page=url.searchParams.get('page');
  if([...url.searchParams].some(([key,value])=>key!=='page' && value!==''))throw new PortalSyncError('Parameter URL di luar pagination publik.','invalid_url');
  url.search='';url.hash='';
  if(page && page!=='1') {
    if(!/^\d+$/.test(page) || Number(page)>2000 || Number(page)<1)throw new PortalSyncError('Nomor halaman tidak valid.','invalid_url');
    url.searchParams.set('page',String(Number(page)));
  }
  return url;
}
function classify(url,parentSection) {
  const seed=PORTAL_SECTIONS.find(section=>section[1]===url.pathname);
  if(seed)return {kind:seed[3],section:seed[0]};
  if(url.pathname.startsWith('/upload/'))return {kind:'attachment',section:parentSection};
  return {kind:'detail',section:/detail_dataset/.test(url.pathname)?'dataset':parentSection};
}

export function parsePortalPage(html,page) {
  if(/Request Rejected|requested URL was rejected|captcha|access denied/i.test(html.slice(0,1500)))throw new PortalSyncError('Akses ditolak oleh situs; tidak mencoba melewati proteksi.','access_rejected');
  const $=load(html);
  const title=clean(page.section==='home'?$('title').text():$('.section-page .hero-section h2').first().text() || $('.section-page h2,.section-page h1').first().text() || $('title').text());
  if(!$('.section-page').length)throw new PortalSyncError('Struktur halaman publik tidak dikenali.','parse_failed');
  // Several pages put substantive tabs outside .section-page (notably Metadata).
  // Read the body, removing chrome below, rather than silently keeping only its intro.
  const main=$('body');
  const items=new Map(),links=new Map();
  const addLink=(href,section=page.section)=>{
    try {const url=portalUrl(href,page.url),type=classify(url,section);links.set(url.href,{url:url.href,...type});return {url:url.href,...type};}
    catch{
      try {
        const url=new URL(href,page.url);
        if(url.protocol==='https:' && !url.username && !url.password && url.origin!==PORTAL_ORIGIN)return {url:url.href,kind:'external',section};
      }catch{ /* Not a public HTTPS link. */ }
      return null;
    }
  };
  const addItem=(link,label,extra={})=>{
    if(!link || label.length<3 || /^(Pratinjau|Unduh|Lihat Detail|Diskominfo Depok)$/i.test(label))return;
    items.set(link.url,{url:link.url,title:label,section:link.section,discoveredFrom:page.url,...extra});
    if(link.kind==='external')links.set(link.url,link);
  };
  main.find('a[href]').each((i,element)=>{
    const anchor=$(element),href=anchor.attr('href');
    if(!href || href.startsWith('#'))return;
    const link=addLink(href);if(!link)return;
    const heading=clean(anchor.find('h6,h3,h2').first().text() || anchor.closest('h3,h6').text());
    if(!heading)return;
    const card=anchor.find('.card-content').first(),publication=anchor.closest('.team-content');
    const publisher=clean(card.find('p').first().text() || publication.find('.data-info a').first().text());
    const periodLabel=clean(card.find('.mb-0').text()).match(/\b(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\b/)?.[0] || '';
    const format=link.kind==='attachment'?(/\.pdf$/i.test(link.url)?'PDF':/\.csv$/i.test(link.url)?'CSV':/\.xlsx?$/i.test(link.url)?'XLSX':'Gambar'):'HTML';
    addItem(link,heading,{publisher,periodLabel,format,description:`${heading}${publisher?` — ${publisher}`:''}. Entri katalog ${page.section}; isi dan nilai observasi belum otomatis diverifikasi.`});
  });
  // Main navigation is also part of the inventory, but never crawl logins,
  // feedback/ticket forms, arbitrary domains or fabricated URLs.
  if(page.section==='home')$('a[href]').each((i,element)=>{
    const anchor=$(element),label=clean(anchor.text());
    try {
      const url=portalUrl(anchor.attr('href'),page.url),seed=PORTAL_SECTIONS.find(section=>section[1]===url.pathname);
      if(seed && label && label.length<80 && !/^\d/.test(label))addItem(addLink(url.href,seed[0]),seed[2],{description:`Halaman ${seed[2]} pada navigasi Portal Satu Data Kota Depok.`});
    } catch { /* External sites are linked, not silently included as evidence. */ }
  });
  main.find('iframe[src]').each((i,element)=>{
    const link=addLink($(element).attr('src'),'insight');
    if(link?.kind==='external')addItem(link,`Dashboard eksternal — ${title}`,{description:'Dashboard tertaut dari portal. Isi layanan eksternal belum diambil dan bukan bukti angka terverifikasi.'});
  });
  if(['gallery','infographic'].includes(page.section))main.find('img[src]').each((i,element)=>{
    try {const url=portalUrl($(element).attr('src'),page.url);if(url.pathname.startsWith('/upload/'))addLink(url.href);}catch{ /* Decorative assets and external images are not fetched. */ }
  });
  const base=portalUrl(page.url);base.search='';
  let lastPage=1;
  $('a.page-link[href],.pagination a[href]').each((i,element)=>{
    try {const url=portalUrl($(element).attr('href'),page.url);if(url.pathname===base.pathname)lastPage=Math.max(lastPage,Number(url.searchParams.get('page') || 1));}catch{ /* Non-page controls. */ }
  });
  for(let number=2;number<=lastPage;number++){const url=new URL(base);url.searchParams.set('page',String(number));addLink(url.href);}
  const found=clean(main.find('.card-search').text()).match(/([\d.,]+)\s+(?:Dataset|Organisasi|Kategori|Data Insight)\s+ditemukan/i);
  const reportedTotal=found?Number(found[1].replace(/[.,]/g,'')):null;
  if(page.kind==='listing' && reportedTotal>0 && !items.size && page.section!=='gallery')throw new PortalSyncError('Katalog berisi entri tetapi parser tidak menemukan kartu; pengambilan ditandai gagal.','parse_failed');
  main.find('.modal').each((i,element)=>{if($(element).find('form,input,textarea,select').length)$(element).remove();});
  // Public metadata/gallery dialogs can contain substantive descriptions.
  // Exclude form dialogs, not every modal simply because it is initially hidden.
  main.find('script,style,header,nav,footer,form,.breadcrumb,input,button,select,textarea').remove();
  const lines=[];
  main.find('h1,h2,h3,h4,h5,h6,p,li,tr').each((i,element)=>{
    const node=$(element);
    if(node.parents('li,tr').length)return;
    const cells=node.is('tr')?node.find('th,td').map((j,cell)=>clean($(cell).text())).get().filter(Boolean):[];
    const text=cells.length>=2?`${cells[0]}: ${cells.slice(1).join(' | ')}`:clean(node.text());
    if((text.length>12 || cells.length>=2 && text.length>8) && !lines.includes(text))lines.push(text);
  });
  const fullBody=lines.join('\n'),body=fullBody.slice(0,2000000),truncated=fullBody.length>body.length;
  if(body.length<30)throw new PortalSyncError('Isi halaman terlalu sedikit untuk dibaca.','parse_failed');
  if(['guide','detail'].includes(page.kind) || page.section==='gallery')addItem({url:page.url,section:page.section},title || 'Halaman portal',{description:body.slice(0,1200)});
  const empty=page.kind==='listing' && (reportedTotal===0 || (items.size===0 && Number(new URL(page.url).searchParams.get('page')||1)>1));
  return {title,body,truncated,empty,items:[...items.values()],links:[...links.values()].filter(link=>link.url!==page.url && !(empty && new URL(link.url).pathname===base.pathname)),reportedTotal};
}

async function readResponse(response,maxBytes=2500000) {
  if(!response.ok)throw new PortalSyncError(`HTTP ${response.status}`,response.status===403?'access_rejected':response.status===429?'rate_limited':'http_error');
  const decoder=new TextDecoder();let text='',size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new PortalSyncError('Halaman melampaui batas ukuran.','too_large');text+=decoder.decode(chunk,{stream:true});}
  return text+decoder.decode();
}

const reading=new Set();
export async function readPortalDetail(store,url,{fetcher=fetch}={}) {
  const page=store.portal.getPage(url);
  if(!page || !['guide','detail'].includes(page.kind) || reading.has(url))return false;
  if(page.status==='fetched')return true;
  if(['blocked','partial'].includes(page.status) || (page.attemptedAt && Date.now()-Date.parse(page.attemptedAt)<300000))return false;
  reading.add(url);
  try {
    const target=portalUrl(url),rules=JSON.parse(store.portal.metadata('robotsRules') || '[]');
    if(!robotsAllow(target.href,rules))throw new PortalSyncError('Dilarang oleh robots.txt.','access_rejected');
    const response=await fetcher(target.href,{headers:{'User-Agent':'AsistenDataDepok/0.3 (public portal inventory)','Accept':'text/html'},redirect:'manual',signal:AbortSignal.timeout(20000)});
    if(response.status>=300 && response.status<400)throw new PortalSyncError('Pengalihan URL perlu ditinjau.','redirect_rejected');
    if(response.ok && !/text\/html/i.test(response.headers.get('content-type') || ''))throw new PortalSyncError('Sumber bukan halaman HTML.','unsupported_format');
    store.portal.savePage(url,parsePortalPage(await readResponse(response),page));
    store.db.prepare("UPDATE portal_pages SET status='unread',error='Lampiran tercatat; isi belum diekstrak.' WHERE kind='attachment' AND status='pending'").run();
    store.db.prepare("UPDATE portal_pages SET status='external',error='Layanan eksternal tidak diambil otomatis.' WHERE kind='external' AND status='pending'").run();
    return store.portal.getPage(url)?.status==='fetched';
  } catch(error) {
    store.portal.fail(url,error instanceof PortalSyncError?error.message:'Pembacaan halaman gagal.',error.code==='access_rejected'?'blocked':'failed');return false;
  } finally {reading.delete(url);}
}

// Parse the applicable public robots groups. An unavailable policy is surfaced,
// not treated as proof of permission or as a reason to bypass a denied page.
export function robotsRules(text) {
  const groups=[];let group=null,hasRules=false;
  for(const raw of text.split(/\r?\n/)) {
    const line=raw.split('#')[0].trim(),match=line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);if(!match)continue;
    const key=match[1].toLowerCase(),value=match[2].trim();
    if(key==='user-agent') {if(!group || hasRules){group={agents:[],rules:[]};groups.push(group);hasRules=false;}group.agents.push(value.toLowerCase());}
    else if(group){hasRules=true;if(value)group.rules.push({allow:key==='allow',path:value});}
  }
  const specific=groups.filter(group=>group.agents.some(agent=>agent!=='*' && 'asistendatadepok'.includes(agent)));
  const selected=specific.length?specific:groups.filter(group=>group.agents.includes('*'));
  return selected.flatMap(group=>group.rules);
}
export function robotsAllow(url,rules) {
  const path=new URL(url).pathname+new URL(url).search;
  const matched=rules.filter(rule=>{
    const expression=rule.path.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$');
    return new RegExp('^'+expression).test(path);
  }).sort((a,b)=>b.path.length-a.path.length || Number(b.allow)-Number(a.allow));
  return !matched.length || matched[0].allow;
}

export async function syncPortal(store,{fetcher=fetch,maxPages=40,includeDetails=false,delayMs=900,refresh=false,signal,onProgress}={}) {
  if(!Number.isInteger(maxPages) || maxPages<1 || maxPages>10000)throw new PortalSyncError('Batas halaman harus 1–10000.','invalid_limit');
  if(!Number.isFinite(delayMs) || delayMs<500)throw new PortalSyncError('Jeda minimal 500 ms agar tidak membebani portal.','invalid_delay');
  const portal=store.portal,run=portal.startRun();let processed=0,failed=0,consecutiveFailures=0,rules=[];
  const headers={'User-Agent':'AsistenDataDepok/0.3 (public portal inventory)','Accept':'text/html,text/plain'};
  try {
    try {
      const response=await fetcher(PORTAL_ORIGIN+'/robots.txt',{headers,redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
      const text=await readResponse(response,128000);
      if(/Request Rejected|<html/i.test(text))throw new Error();
      rules=robotsRules(text);portal.metadata('robots','available');portal.metadata('robotsRules',JSON.stringify(rules));
    } catch {portal.metadata('robots','unavailable: kebijakan tidak berhasil dibaca; koordinasikan pengambilan massal dengan pengelola.');}
    portal.reconcilePagination();
    if(refresh)portal.refreshPages(includeDetails);
    for(const [section,path,,kind] of PORTAL_SECTIONS)portal.queue(PORTAL_ORIGIN+path,kind,section,'',refresh);
    while(processed<maxPages) {
      signal?.throwIfAborted();
      const page=portal.nextPage(includeDetails,false,run.startedAt);if(!page)break;
      if(processed)await delay(delayMs,undefined,{signal});
      try {
        if(!robotsAllow(page.url,rules))throw new PortalSyncError('Dilarang oleh robots.txt.','access_rejected');
        const target=portalUrl(page.url);
        const response=await fetcher(target.href,{headers,redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
        // Redirects must be reviewed instead of following them outside the allowlist.
        if(response.status>=300 && response.status<400)throw new PortalSyncError('Pengalihan URL perlu diperiksa pengelola.','redirect_rejected');
        if(response.ok && !/text\/html/i.test(response.headers.get('content-type') || ''))throw new PortalSyncError('Halaman bukan HTML.','unsupported_format');
        const html=await readResponse(response),parsed=parsePortalPage(html,page);
        portal.savePage(page.url,parsed);
        consecutiveFailures=0;
        store.db.prepare("UPDATE portal_pages SET status='unread',error='Lampiran tercatat untuk navigasi; ekstraksi isi belum dijalankan.' WHERE kind='attachment' AND status='pending'").run();
        store.db.prepare("UPDATE portal_pages SET status='external',error='Tautan ditemukan pada portal; layanan eksternal tidak diambil otomatis.' WHERE kind='external' AND status='pending'").run();
      } catch(error) {
        if(signal?.aborted)throw error;
        failed++;consecutiveFailures++;portal.fail(page.url,error instanceof PortalSyncError?error.message:'Koneksi atau pembacaan halaman gagal.',error.code==='access_rejected'?'blocked':'failed');
        if(error.code==='rate_limited' || consecutiveFailures>=3) {processed++;portal.updateRun(run.id,processed,failed);portal.finishRun(run.id,'paused','Situs membatasi permintaan atau tiga halaman berturut-turut gagal. Periksa sebelum melanjutkan; tidak mencoba melewati proteksi.');return portal.coverage();}
      }
      processed++;portal.updateRun(run.id,processed,failed);onProgress?.({processed,failed,url:page.url});
    }
    const pending=portal.nextPage(includeDetails,false,run.startedAt);
    portal.finishRun(run.id,pending?'paused':failed?'completed_with_errors':'completed',pending?'Batas batch tercapai; lanjutkan antrean pada batch berikutnya.':'Antrean yang dipilih selesai. Ini bukan klaim seluruh konten dan lampiran website sudah dibaca.');
  } catch(error) {
    portal.finishRun(run.id,signal?.aborted?'cancelled':'failed','Sinkronisasi terhenti; entri sebelumnya tetap disimpan.');throw error;
  }
  return portal.coverage();
}
