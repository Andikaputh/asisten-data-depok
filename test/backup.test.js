import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { validateImport } from '../server/import.js';
import { buildBackup, restoreBackup, BACKUP_VERSION } from '../server/backup.js';
import { createApp } from '../server/index.js';
import { PORTAL_ORIGIN } from '../server/portal-sync.js';

const csv = 'indicator,year,region,value,unit\nPersentase uji cadangan,2025,Kota Uji,53.09,persen\n';
const importPayload = () => validateImport({
  title:'Sumber uji cadangan',publisher:'Penguji otomatis',sourceUrl:'https://example.org/sumber-uji',
  content:csv,kind:'csv',year:'2025',region:'Kota Uji',
});
const config = { baseUrl:'http://127.0.0.1:1',chatModel:'',embeddingModel:'' };
const listing = PORTAL_ORIGIN + '/User/dataset';

function fixture() {
  const store = createStore(':memory:', false);
  const input = importPayload();
  const added = store.add(input.document, input.observations);
  store.verify(added.document.id, 'Penguji');
  store.add({
    title:'Glosarium uji',publisher:'Penguji otomatis',sourceUrl:'https://example.org/glosarium',
    content:'Metadata menjelaskan konteks data. Satuan menyatakan ukuran nilai.',kind:'text',status:'unverified',
  });
  store.portal.queue(listing, 'listing', 'dataset');
  store.portal.savePage(listing, {
    title:'Dataset', body:'2 Dataset ditemukan\nKatalog dataset publik untuk pengujian.', items:[{
      url:PORTAL_ORIGIN + '/User/detail_dataset/uji', title:'Jumlah Penduduk Uji', section:'dataset',
      publisher:'Dinas Uji', description:'Data penduduk untuk pengujian cadangan.', discoveredFrom:listing,
    }], links:[], reportedTotal:2,
  });
  store.portal.metadata('reported:dataset', '2');
  return { store, id: added.document.id };
}

test('cadangan memulihkan dokumen, observasi, dan inventaris portal', () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  try {
    const backup = buildBackup(source.store);
    assert.equal(backup.version, BACKUP_VERSION);
    assert.equal(backup.summary.documents, 2);
    assert.equal(backup.summary.verified, 1);
    assert.equal(backup.summary.observations, 1);

    const result = restoreBackup(target, JSON.parse(JSON.stringify(backup)));
    assert.equal(result.documents.added, 2);
    assert.equal(result.documents.skipped, 0);
    assert.equal(result.observations.added, 1);
    assert.equal(result.portal.items, 1);
    assert.equal(result.portal.pages, 1);

    assert.equal(target.get(source.id).status, 'verified');
    assert.equal(target.observations().length, 1);
    assert.ok(target.activeChunks('verified').length > 0);
    assert.match(target.portal.getPage(listing).body, /Katalog dataset publik/);
    assert.ok(target.portal.search('penduduk uji').some(item => item.url.endsWith('/detail_dataset/uji')));
    assert.equal(target.portal.metadata('reported:dataset'), '2');
  } finally { source.store.close(); target.close(); }
});

test('isi dokumen yang diubah menggagalkan seluruh pemulihan tanpa menulis apa pun', () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  try {
    const backup = buildBackup(source.store);
    backup.documents[0].content += ' tambahan yang tidak cocok dengan hash';
    assert.throws(() => restoreBackup(target, backup), /hash/);
    assert.equal(target.list().length, 0);
    assert.equal(target.portal.coverage().items, 0);
  } finally { source.store.close(); target.close(); }
});

test('halaman portal dengan hash tidak cocok ditolak', () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  try {
    const backup = buildBackup(source.store);
    backup.portal.pages[0].body += ' perubahan';
    assert.throws(() => restoreBackup(target, backup), /hash/);
    assert.equal(target.portal.coverage().pages.length, 0);
  } finally { source.store.close(); target.close(); }
});

test('ekspor lama versi 1 tetap dapat dipulihkan', () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  try {
    const legacy = { version:1, exportedAt:new Date().toISOString(), documents:source.store.list(), observations:source.store.observations() };
    const result = restoreBackup(target, legacy);
    assert.equal(result.documents.added, 2);
    assert.equal(target.observations().length, 1);
    assert.equal(target.portal.coverage().items, 0);
  } finally { source.store.close(); target.close(); }
});

test('pemulihan berulang tidak menggandakan data', () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  try {
    const backup = buildBackup(source.store);
    restoreBackup(target, backup);
    const second = restoreBackup(target, backup);
    assert.equal(second.documents.added, 0);
    assert.equal(second.documents.skipped, 2);
    assert.equal(target.list().length, 2);
    assert.equal(target.observations().length, 1);
    assert.equal(target.portal.coverage().items, 1);
    assert.equal(target.portal.coverage().fetched, 1);
  } finally { source.store.close(); target.close(); }
});

test('opsi as-unverified menurunkan status dan mengosongkan peninjau', () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  try {
    const result = restoreBackup(target, buildBackup(source.store), { asUnverified:true });
    assert.equal(result.documents.downgraded, 1);
    const document = target.get(source.id);
    assert.equal(document.status, 'unverified');
    assert.equal(document.reviewer, null);
    assert.equal(target.observations().length, 0);
    assert.match(result.warnings.join(' '), /diturunkan/);
  } finally { source.store.close(); target.close(); }
});

test('uji coba (dry run) menghitung tanpa menulis', () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  try {
    const result = restoreBackup(target, buildBackup(source.store), { dryRun:true });
    assert.equal(result.dryRun, true);
    assert.equal(result.documents.added, 2);
    assert.equal(target.list().length, 0);
    assert.equal(target.portal.coverage().items, 0);
    assert.match(result.warnings.join(' '), /tidak ada data yang ditulis/);
  } finally { source.store.close(); target.close(); }
});

test('validasi menolak domain halaman asing, URL tidak aman, dan versi tak dikenal', () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  try {
    const foreign = buildBackup(source.store);
    foreign.portal.pages[0].url = 'https://evil.example/halaman';
    assert.throws(() => restoreBackup(target, foreign), /domain portal/);

    const unsafe = buildBackup(source.store);
    unsafe.documents[0].sourceUrl = 'javascript:alert(1)';
    assert.throws(() => restoreBackup(target, unsafe), /HTTPS/);

    const future = buildBackup(source.store);
    future.version = 99;
    assert.throws(() => restoreBackup(target, future), /Versi cadangan/);

    const orphan = buildBackup(source.store);
    orphan.observations[0].documentId = 'tidak-ada';
    assert.throws(() => restoreBackup(target, orphan), /dokumen yang tidak ada/);
  } finally { source.store.close(); target.close(); }
});

test('cadangan memuat hasil ekstraksi lampiran beserta status bacanya', () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  const url = PORTAL_ORIGIN + '/upload/file/profil-kesehatan.pdf';
  try {
    source.store.portal.queue(url, 'attachment', 'publication');
    source.store.portal.saveAttachment(url, {
      format:'pdf', text:'Profil kesehatan Kota Depok memuat indikator sampah.', contentType:'application/pdf', bytes:12345, detail:{ pages:12 },
    });
    const backup = buildBackup(source.store);
    assert.equal(backup.summary.attachmentPages, 1);
    assert.match(restoreBackup(target, backup).warnings.join(' '), /lampiran/i);

    const page = target.portal.getPage(url);
    assert.equal(page.status, 'fetched');
    assert.equal(page.contentType, 'application/pdf');
    assert.equal(page.bytes, 12345);
    assert.match(page.extractor, /PDF/);
    assert.ok(target.portal.readSearch('profil kesehatan').some(row => row.url === url));
    assert.equal(target.portal.card(target.portal.getByUrl(url) || { url }).status, 'attachment-read');
  } finally { source.store.close(); target.close(); }
});

test('endpoint HTTP mengekspor dan memulihkan cadangan lengkap', async () => {
  const source = fixture();
  const target = createStore(':memory:', false);
  const sourceApp = createApp({ store:source.store, config });
  const targetApp = createApp({ store:target, config });
  await new Promise(resolve => sourceApp.server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => targetApp.server.listen(0, '127.0.0.1', resolve));
  const sourceBase = `http://127.0.0.1:${sourceApp.server.address().port}`;
  const targetBase = `http://127.0.0.1:${targetApp.server.address().port}`;
  try {
    const exported = await (await fetch(sourceBase + '/api/export')).json();
    assert.equal(exported.version, BACKUP_VERSION);
    assert.ok(exported.summary.portalPages >= 1);

    const response = await fetch(targetBase + '/api/restore', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(exported) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.documents.added, 2);

    const status = await (await fetch(targetBase + '/api/status')).json();
    assert.equal(status.counts.verified, 1);
    assert.equal(status.observations, 1);
    assert.ok(status.portal.items >= 1);

    const invalid = await fetch(targetBase + '/api/restore', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ version:1, documents:'bukan-array' }) });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise(resolve => sourceApp.server.close(resolve));
    await new Promise(resolve => targetApp.server.close(resolve));
    source.store.close(); target.close();
  }
});
