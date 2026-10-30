import {createHash,randomUUID} from 'node:crypto';
import {normalize,tokens} from './retrieval.js';

const generic=new Set('portal website situs satu depok sini situ disini disitu mana dimanakah dimana temukan terkait informasi cari carikan mencari cariin tersedia ketersediaan ingin butuh membutuhkan tentang mengenai tolong bantu dong kah ga gak nggak enggak adakah ada lihat buka akses dalam semua saja publikasi dataset data apakah bagaimana gimana cara caranya unduh mengunduh download format jelaskan pengertian'.split(' '));
const synonyms={warga:['penduduk'],difabel:['disabilitas'],disdukcapil:['kependudukan','pencatatan','sipil'],diskominfo:['komunikasi','informatika'],dlhk:['lingkungan','hidup','kebersihan']};
export function portalTerms(question) {
  return [...new Set(tokens(question).flatMap(term=>synonyms[term] || [term]).filter(term=>!generic.has(term)))].slice(0,20);
}
const digest=value=>createHash('sha256').update(value).digest('hex');
const itemIdentity=item=>item.section==='bps' && new URL(item.url).hostname!=='satudata.depok.go.id'?`bps:${normalize(item.title)}`:item.url;

// Separate inventory: a catalog entry is NOT a verified statistical observation.
// This migration only adds tables; it never rewrites the existing reviewed corpus.
export function createPortalStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_pages (
      url TEXT PRIMARY KEY, kind TEXT NOT NULL, section TEXT NOT NULL,
      discoveredFrom TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', hash TEXT,
      attemptedAt TEXT, fetchedAt TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS portal_queue ON portal_pages(status,kind);
    CREATE TABLE IF NOT EXISTS portal_items (
      id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      section TEXT NOT NULL, publisher TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      periodLabel TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT 'HTML',
      discoveredFrom TEXT NOT NULL, firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS portal_items_fts USING fts5(id UNINDEXED,title,publisher,description,tokenize='unicode61');
    CREATE VIRTUAL TABLE IF NOT EXISTS portal_pages_fts USING fts5(url UNINDEXED,title,body,tokenize='unicode61');
    CREATE TABLE IF NOT EXISTS portal_sync_runs (
      id TEXT PRIMARY KEY, startedAt TEXT NOT NULL, finishedAt TEXT, status TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS portal_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
  `);
  const columns=new Set(db.prepare('PRAGMA table_info(portal_items)').all().map(column=>column.name));
  if(!columns.has('identityKey')) {
    db.exec('ALTER TABLE portal_items ADD COLUMN identityKey TEXT');
    // Signed BPS download URLs can change on every request. Deduplicate only
    // this generated inventory, retaining the latest observed official link.
    const seen=new Set();
    for(const item of db.prepare('SELECT * FROM portal_items ORDER BY lastSeenAt DESC,rowid DESC').all()) {
      const key=itemIdentity(item);
      if(seen.has(key)){db.prepare('DELETE FROM portal_items WHERE id=?').run(item.id);db.prepare('DELETE FROM portal_items_fts WHERE id=?').run(item.id);}
      else {seen.add(key);db.prepare('UPDATE portal_items SET identityKey=? WHERE id=?').run(key,item.id);}
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS portal_item_identity ON portal_items(identityKey)');
  }
  if(!db.prepare('PRAGMA table_info(portal_sync_runs)').all().some(column=>column.name==='ownerPid'))db.exec('ALTER TABLE portal_sync_runs ADD COLUMN ownerPid INTEGER');
  const pageColumns=new Set(db.prepare('PRAGMA table_info(portal_pages)').all().map(column=>column.name));
  for(const [name,definition] of [['contentType',"TEXT NOT NULL DEFAULT ''"],['bytes','INTEGER NOT NULL DEFAULT 0'],['extractor',"TEXT NOT NULL DEFAULT ''"]]) {
    if(!pageColumns.has(name))db.exec(`ALTER TABLE portal_pages ADD COLUMN ${name} ${definition}`);
  }
  if(db.prepare("SELECT value FROM portal_metadata WHERE key='page_fts_version'").get()?.value!=='3') {
    db.exec("DELETE FROM portal_pages_fts; INSERT INTO portal_pages_fts(url,title,body) SELECT url,title,body FROM portal_pages WHERE status='fetched' AND body!='' AND (kind IN ('guide','detail','attachment') OR section='gallery')");
    db.prepare("INSERT INTO portal_metadata(key,value) VALUES ('page_fts_version','3') ON CONFLICT(key) DO UPDATE SET value='3'").run();
  }
  const portal={
    queue(url,kind,section,discoveredFrom='',refresh=false) {
      db.prepare('INSERT OR IGNORE INTO portal_pages(url,kind,section,discoveredFrom) VALUES (?,?,?,?)').run(url,kind,section,discoveredFrom);
      if(refresh)db.prepare("UPDATE portal_pages SET status='pending',error=NULL WHERE url=? AND status!='pending'").run(url);
      else if(discoveredFrom)db.prepare("UPDATE portal_pages SET status='pending',error=NULL WHERE url=? AND status IN ('empty','skipped')").run(url);
    },
    refreshPages(includeDetails=false,includeAttachments=false) {db.prepare(`UPDATE portal_pages SET status='pending',error=NULL WHERE kind IN ('guide','listing'${includeDetails?",'detail'":''}${includeAttachments?",'attachment'":''}) AND status NOT IN ('empty','skipped')`).run();},
    nextPage(includeDetails=false,includeAttachments=false,runStarted='') {
      portal.reconcilePagination();
      const kinds=['listing','guide',...(includeDetails?['detail']:[]),...(includeAttachments?['attachment']:[])];
      return db.prepare(`SELECT * FROM portal_pages WHERE kind IN (${kinds.map(()=>'?').join(',')}) AND
        (status='pending' OR (status IN ('failed','blocked') AND (attemptedAt IS NULL OR attemptedAt<?)))
        ORDER BY CASE kind WHEN 'guide' THEN 0 WHEN 'listing' THEN 1 WHEN 'detail' THEN 2 ELSE 3 END,rowid LIMIT 1`).get(...kinds,runStarted);
    },
    // Attachments run in their own phase so a large PDF never blocks the page
    // queue. Failed/blocked files wait for a cooldown and stop after 3 tries.
    nextAttachment(cutoff=new Date(Date.now()-300000).toISOString()) {
      return db.prepare(`SELECT * FROM portal_pages WHERE kind='attachment' AND
        (status IN ('pending','unread') OR (status IN ('failed','blocked') AND attemptedAt<? AND attempts<3))
        ORDER BY rowid LIMIT 1`).get(cutoff);
    },
    getPage(url) {return db.prepare('SELECT * FROM portal_pages WHERE url=?').get(url);},
    get(id) {return db.prepare('SELECT * FROM portal_items WHERE id=?').get(id);},
    getByUrl(url) {return db.prepare('SELECT * FROM portal_items WHERE url=?').get(url);},
    putItem(input) {
      const now=new Date().toISOString(),identityKey=itemIdentity(input);
      const id=db.prepare('SELECT id FROM portal_items WHERE identityKey=?').get(identityKey)?.id || `portal-${digest(identityKey).slice(0,24)}`;
      const item={publisher:'',description:'',periodLabel:'',format:'HTML',...input,id};
      db.prepare(`INSERT INTO portal_items(id,url,title,section,publisher,description,periodLabel,format,discoveredFrom,firstSeenAt,lastSeenAt,identityKey)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,title=excluded.title,section=excluded.section,
        publisher=excluded.publisher,description=excluded.description,periodLabel=excluded.periodLabel,format=excluded.format,
        discoveredFrom=excluded.discoveredFrom,lastSeenAt=excluded.lastSeenAt`).run(id,item.url,item.title.slice(0,500),item.section,item.publisher.slice(0,300),item.description.slice(0,3000),item.periodLabel,item.format,item.discoveredFrom,now,now,identityKey);
      db.prepare('DELETE FROM portal_items_fts WHERE id=?').run(id);
      db.prepare('INSERT INTO portal_items_fts(id,title,publisher,description) VALUES (?,?,?,?)').run(id,item.title,item.publisher,`${item.description} ${item.periodLabel}`);
      return portal.get(id);
    },
    savePage(url,{title,body,items=[],links=[],reportedTotal,truncated=false,empty=false}) {
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE portal_pages SET status=?,title=?,body=?,hash=?,attemptedAt=?,fetchedAt=?,error=?,attempts=attempts+1 WHERE url=?')
          .run(empty?'empty':truncated?'partial':'fetched',title,body,digest(body),new Date().toISOString(),new Date().toISOString(),truncated?'Isi melampaui batas teks; halaman hanya terbaca sebagian dan tidak dipakai sebagai bukti lengkap.':null,url);
        db.prepare('DELETE FROM portal_pages_fts WHERE url=?').run(url);
        const page=portal.getPage(url);
        if(!truncated && (['guide','detail','attachment'].includes(page.kind) || page.section==='gallery') && body)db.prepare('INSERT INTO portal_pages_fts(url,title,body) VALUES (?,?,?)').run(url,title,body);
        for(const item of items)portal.putItem(item);
        for(const link of links)portal.queue(link.url,link.kind,link.section,url);
        if(reportedTotal)portal.metadata(`reported:${page.section}`,String(Math.max(reportedTotal,Number(portal.metadata(`reported:${page.section}`)||0))));
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
    },
    fail(url,error,status='failed') {
      db.prepare('UPDATE portal_pages SET status=?,attemptedAt=?,error=?,attempts=attempts+1 WHERE url=?').run(status,new Date().toISOString(),String(error).slice(0,500),url);
    },
    // Automatic extraction is recorded as a reading step, never as human
    // verification. Truncated text is stored for inspection but left out of FTS.
    saveAttachment(url,{format='pdf',text='',truncated=false,contentType='',bytes=0,detail={}}) {
      const now=new Date().toISOString(),empty=!text;
      const status=empty?'empty':truncated?'partial':'fetched';
      const note=empty?'Tidak ada teks yang dapat diekstrak; kemungkinan hasil pindai. OCR tidak dijalankan.'
        :truncated?'Sebagian isi lampiran dipotong karena melebihi batas teks; tidak dipakai untuk pencarian.'
        :null;
      const extractor=`${String(format).toUpperCase()}${detail.pages?` · ${detail.pages} halaman`:detail.rows?` · ${detail.rows} baris`:''}`;
      db.exec('BEGIN');
      try {
        db.prepare(`UPDATE portal_pages SET status=?,body=?,hash=?,attemptedAt=?,fetchedAt=?,error=?,attempts=attempts+1,
          contentType=?,bytes=?,extractor=? WHERE url=?`).run(status,text,digest(text),now,now,note,String(contentType).slice(0,200),bytes,extractor,url);
        db.prepare('DELETE FROM portal_pages_fts WHERE url=?').run(url);
        if(status==='fetched' && text)db.prepare('INSERT INTO portal_pages_fts(url,title,body) SELECT url,title,body FROM portal_pages WHERE url=?').run(url);
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
    },
    failAttachment(url,error,status='failed') {portal.fail(url,error,status);},
    metadata(key,value) {
      if(value!==undefined)db.prepare('INSERT INTO portal_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
      return db.prepare('SELECT value FROM portal_metadata WHERE key=?').get(key)?.value;
    },
    reconcilePagination() {
      // Some portal pages render a Next link forever, even past their last row.
      // Keep the empty-page audit but never keep following that unbounded chain.
      const bounds=new Map();
      for(const page of db.prepare("SELECT url,body,status FROM portal_pages WHERE kind='listing' AND (status='empty' OR (status='fetched' AND body LIKE '%0 %ditemukan%'))").all()) {
        if(page.status!=='empty' && !/(?:^|\n)0\s+(?:Organisasi|Dataset|Kategori|Data Insight)\s+ditemukan/i.test(page.body))continue;
        const url=new URL(page.url),number=Number(url.searchParams.get('page')||1);
        bounds.set(url.pathname,Math.min(bounds.get(url.pathname)||Infinity,number));
        if(page.status!=='empty')db.prepare("UPDATE portal_pages SET status='empty' WHERE url=?").run(page.url);
      }
      for(const page of db.prepare("SELECT url FROM portal_pages WHERE kind='listing' AND status='pending'").all()) {
        const url=new URL(page.url),bound=bounds.get(url.pathname);
        if(bound && Number(url.searchParams.get('page')||1)>=bound)db.prepare("UPDATE portal_pages SET status='skipped',error='Pagination melewati halaman kosong yang sudah dikonfirmasi.' WHERE url=?").run(page.url);
      }
    },
    startRun() {
      portal.recoverRuns();
      if(db.prepare("SELECT id FROM portal_sync_runs WHERE status='running' LIMIT 1").get())throw new Error('Sinkronisasi portal lain masih berjalan.');
      const run={id:randomUUID(),startedAt:new Date().toISOString()};
      db.prepare("INSERT INTO portal_sync_runs(id,startedAt,status,ownerPid) VALUES (?,?,'running',?)").run(run.id,run.startedAt,process.pid);return run;
    },
    updateRun(id,processed,failed) {db.prepare('UPDATE portal_sync_runs SET processed=?,failed=? WHERE id=?').run(processed,failed,id);},
    finishRun(id,status,note='') {db.prepare('UPDATE portal_sync_runs SET status=?,finishedAt=?,note=? WHERE id=?').run(status,new Date().toISOString(),note,id);},
    recoverRuns() {
      for(const run of db.prepare("SELECT id,ownerPid FROM portal_sync_runs WHERE status='running'").all()) {
        let alive=false;try{if(run.ownerPid){process.kill(Number(run.ownerPid),0);alive=true;}}catch(error){alive=error.code!=='ESRCH';}
        if(!alive)db.prepare("UPDATE portal_sync_runs SET status='interrupted',finishedAt=?,note='Proses sebelumnya berhenti; antrean dapat dilanjutkan.' WHERE id=?").run(new Date().toISOString(),run.id);
      }
    },
    browse({section,limit=20,offset=0}={}) {
      const filter=section?'WHERE section=?':'',values=section?[section]:[];
      return {total:db.prepare(`SELECT count(*) AS total FROM portal_items ${filter}`).get(...values).total,
        items:db.prepare(`SELECT * FROM portal_items ${filter} ORDER BY title LIMIT ? OFFSET ?`).all(...values,limit,offset)};
    },
    search(question,{limit=6,section}={}) {
      const terms=portalTerms(question);
      if(!terms.length)return [];
      const match=terms.map(term=>`"${term.replaceAll('"','""')}"`).join(' OR ');
      const rows=db.prepare(`SELECT i.*,bm25(portal_items_fts,0,5,2,1) AS rank FROM portal_items_fts
        JOIN portal_items i ON i.id=portal_items_fts.id WHERE portal_items_fts MATCH ? ${section?'AND i.section=?':''} ORDER BY rank LIMIT 80`).all(match,...(section?[section]:[]));
      return rows.map(row=>{
        const title=tokens(row.title),all=tokens(`${row.title} ${row.publisher} ${row.description}`);
        const hits=terms.filter(term=>all.includes(term)).length;
        const year=(question.match(/\b(?:19|20)\d{2}\b/g)||[]).some(value=>`${row.title} ${row.periodLabel}`.includes(value));
        const titleYear=Math.max(0,...(row.title.match(/\b(?:19|20)\d{2}\b/g)||[]).map(Number));
        return {...row,hits,titleYear,score:terms.filter(term=>title.includes(term)).length*4+hits+(year?2:0)};
      }).filter(row=>row.hits>=Math.min(2,terms.length)).sort((a,b)=>b.score-a.score || b.titleYear-a.titleYear || a.rank-b.rank).slice(0,limit);
    },
    readSearch(question,limit=3) {
      const terms=portalTerms(question).filter(term=>!['definisi','metadata','indikator','satuan'].includes(term));
      const queryTerms=terms.length?terms:tokens(question).filter(term=>!generic.has(term));
      if(!queryTerms.length)return [];
      const match=queryTerms.map(term=>`"${term.replaceAll('"','""')}"`).join(' OR ');
      return db.prepare(`SELECT p.*,bm25(portal_pages_fts,0,5,1) AS rank FROM portal_pages_fts JOIN portal_pages p ON p.url=portal_pages_fts.url
        WHERE portal_pages_fts MATCH ? AND p.status='fetched' ORDER BY rank LIMIT 20`).all(match)
        .filter(row=>queryTerms.filter(term=>tokens(`${row.title} ${row.body}`).includes(term)).length>=Math.min(2,queryTerms.length)).slice(0,limit);
    },
    coverage() {
      const sections=db.prepare('SELECT section,count(*) AS total FROM portal_items GROUP BY section').all();
      const pages=db.prepare('SELECT kind,status,count(*) AS total FROM portal_pages GROUP BY kind,status').all();
      const count=status=>pages.filter(row=>row.status===status).reduce((sum,row)=>sum+row.total,0);
      const datasets=db.prepare("SELECT count(*) AS total FROM portal_items WHERE url LIKE 'https://satudata.depok.go.id/User/detail_dataset/%'").get().total;
      const reportedDatasets=Number(portal.metadata('reported:dataset') || 0);
      const lastRun=db.prepare('SELECT * FROM portal_sync_runs ORDER BY startedAt DESC,rowid DESC LIMIT 1').get() || null;
      const attachments=status=>pages.filter(row=>row.kind==='attachment' && row.status===status).reduce((sum,row)=>sum+row.total,0);
      return {items:sections.reduce((sum,row)=>sum+row.total,0),sections,pages,
        contentPages:db.prepare("SELECT count(*) AS total FROM portal_pages WHERE status='fetched' AND (kind IN ('guide','detail') OR section='gallery')").get().total,
        fetched:count('fetched'),empty:count('empty'),skipped:count('skipped'),partial:count('partial'),pending:count('pending'),failed:count('failed'),blocked:count('blocked'),external:count('external'),
        readAttachments:attachments('fetched'),partialAttachments:attachments('partial'),skippedAttachments:attachments('skipped'),emptyAttachments:attachments('empty'),
        unreadAttachments:pages.filter(row=>row.kind==='attachment' && ['pending','unread'].includes(row.status)).reduce((sum,row)=>sum+row.total,0),
        datasets,reportedDatasets,websiteComplete:false,lastRun,
        robots:portal.metadata('robots') || 'not_checked',
        // Reading statistics are never presented as human review.
        issues:db.prepare("SELECT url,kind,status,error,attemptedAt FROM portal_pages WHERE status IN ('failed','blocked','unread','partial') ORDER BY attemptedAt DESC LIMIT 12").all(),
        note:'Inventaris dari halaman publik yang dijangkau, bukan bukti seluruh website sudah dipahami. Lampiran PDF/XLSX hanya dibaca bila opsi ekstraksi dijalankan; gambar, CSV, .xls, dan dashboard eksternal tidak diekstrak.'};
    },
    card(item) {
      const url=item?.url;if(!url)return null;
      const page=portal.getPage(url);
      // Search may surface an attachment that has no catalog card of its own.
      const entry=item?.title?item:{id:`portal-${digest(url).slice(0,24)}`,url,title:page?.title || url,publisher:'',description:(page?.body || '').slice(0,1200),
        section:page?.section || 'dataset',format:page?.kind==='attachment'?'Berkas':'HTML',periodLabel:'',discoveredFrom:page?.discoveredFrom || '',lastSeenAt:page?.fetchedAt || ''};
      const read=page?.status==='fetched' && (['guide','detail'].includes(page.kind) || page.section==='gallery');
      const attachment=page?.kind==='attachment' && ['fetched','partial'].includes(page.status);
      const contentStatus=read?'read':attachment?(page.status==='partial'?'attachment_partial':'attachment_read'):'catalogue_only';
      return {id:entry.id,documentId:entry.id,title:entry.title,url:entry.url,publisher:entry.publisher || 'Portal Satu Data Kota Depok',
        status:read?'portal-read':attachment?'attachment-read':'catalogued',year:null,region:null,version:1,retrievedAt:entry.lastSeenAt,
        excerpt:entry.description,kind:entry.section,format:entry.format,periodLabel:entry.periodLabel,contentStatus,
        contentType:page?.contentType || '',bytes:page?.bytes || 0,extractor:page?.extractor || '',discoveredFrom:entry.discoveredFrom};
    },
    source(id) {
      const item=portal.get(id);if(!item)return null;
      const page=portal.getPage(item.url),card=portal.card(item);
      return {...card,sourceUrl:item.url,content:page?.body || item.description || item.title,description:item.description,
        provenance:JSON.stringify({method:'public_portal_inventory',discoveredFrom:item.discoveredFrom,contentStatus:card.contentStatus}),hash:page?.hash || digest(item.url),reviewedAt:null};
    },
    // Restoring a backup replaces entries with the same identity. It does not
    // require a fresh crawl and never converts catalog entries into evidence.
    restore({items=[],pages=[],runs=[],metadata={}}) {
      const counts={items:0,pages:0,runs:0,metadata:0};
      const removeItem=db.prepare('DELETE FROM portal_items WHERE id=?');
      const insertItem=db.prepare(`INSERT INTO portal_items(id,url,title,section,publisher,description,periodLabel,format,discoveredFrom,firstSeenAt,lastSeenAt,identityKey)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,title=excluded.title,section=excluded.section,
        publisher=excluded.publisher,description=excluded.description,periodLabel=excluded.periodLabel,format=excluded.format,
        discoveredFrom=excluded.discoveredFrom,firstSeenAt=excluded.firstSeenAt,lastSeenAt=excluded.lastSeenAt,identityKey=excluded.identityKey`);
      const insertPage=db.prepare(`INSERT INTO portal_pages(url,kind,section,discoveredFrom,status,title,body,hash,attemptedAt,fetchedAt,error,attempts,contentType,bytes,extractor)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET kind=excluded.kind,section=excluded.section,
        discoveredFrom=excluded.discoveredFrom,status=excluded.status,title=excluded.title,body=excluded.body,hash=excluded.hash,
        attemptedAt=excluded.attemptedAt,fetchedAt=excluded.fetchedAt,error=excluded.error,attempts=excluded.attempts,
        contentType=excluded.contentType,bytes=excluded.bytes,extractor=excluded.extractor`);
      db.exec('BEGIN');
      try {
        for(const item of items) {
          for(const row of db.prepare('SELECT id FROM portal_items WHERE (identityKey=? OR url=?) AND id!=?').all(item.identityKey,item.url,item.id))removeItem.run(row.id);
          insertItem.run(item.id,item.url,item.title,item.section,item.publisher,item.description,item.periodLabel,item.format,item.discoveredFrom,item.firstSeenAt,item.lastSeenAt,item.identityKey);
          counts.items++;
        }
        for(const page of pages) {
          insertPage.run(page.url,page.kind,page.section,page.discoveredFrom,page.status,page.title,page.body,page.hash,page.attemptedAt,page.fetchedAt,page.error,page.attempts,
            page.contentType || '',page.bytes || 0,page.extractor || '');
          counts.pages++;
        }
        for(const run of runs) {
          db.prepare('INSERT OR IGNORE INTO portal_sync_runs(id,startedAt,finishedAt,status,processed,failed,note) VALUES (?,?,?,?,?,?,?)')
            .run(run.id,run.startedAt,run.finishedAt,run.status,run.processed,run.failed,run.note);
          counts.runs++;
        }
        for(const [key,value] of Object.entries(metadata)) {
          if(key==='page_fts_version')continue;
          portal.metadata(key,String(value));
          counts.metadata++;
        }
        db.exec('DELETE FROM portal_items_fts');
        db.exec("INSERT INTO portal_items_fts(id,title,publisher,description) SELECT id,title,publisher,description||' '||periodLabel FROM portal_items");
        db.exec('DELETE FROM portal_pages_fts');
        db.exec("INSERT INTO portal_pages_fts(url,title,body) SELECT url,title,body FROM portal_pages WHERE status='fetched' AND body!='' AND (kind IN ('guide','detail','attachment') OR section='gallery')");
        // The FTS rebuild above is authoritative for this app version.
        portal.metadata('page_fts_version','3');
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
      return counts;
    },
  };
  return portal;
}
