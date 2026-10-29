import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { createApp } from '../server/index.js';
import { createStore } from '../server/store.js';

// Disposable in-memory corpus: browser tests never alter the user's local source collection.
const store = createStore(':memory:');
const { server } = createApp({ store, config:{ provider:'ollama',baseUrl:'http://127.0.0.1:1',chatModel:'',embeddingModel:'' } });
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// Use Playwright's isolated Chromium by default, never a personal browser profile.
const executablePath = process.env.BROWSER_PATH;
if(executablePath && !existsSync(executablePath))throw new Error('BROWSER_PATH tidak ditemukan.');
mkdirSync('.artifacts',{recursive:true});
let browser;
try {
  browser = await chromium.launch({headless:true,...(executablePath ? {executablePath} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  page.on('console',message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base+'/workspace'); await page.locator('#nav-count').filter({hasText:'6'}).waitFor();
  assert.equal(await page.title(),'Asisten Data Depok — Ruang pengelolaan');
  await page.screenshot({path:'.artifacts/asisten-data-desktop.png',fullPage:true});
  await page.locator('.prompt-card[data-prompt*="metadata"]').click();
  await page.locator('.excerpts li').first().waitFor();
  assert.match(await page.locator('#messages').innerText(),/bukan dokumen resmi/);
  assert.ok(await page.locator('.answer-source').count() >= 1);
  await page.reload(); await page.locator('.excerpts li').first().waitFor();
  assert.match(await page.locator('#messages').innerText(),/metadata/i);
  console.log('PASS Percakapan latihan, kartu sumber, dan riwayat setelah reload');

  await page.locator('[data-scope="verified"]').click();
  await page.locator('#question').fill('Jelaskan definisi penanganan sampah');
  await page.locator('#send-button').click();
  await page.getByText('Belum ada bukti yang sesuai dalam koleksi publik terverifikasi.',{exact:false}).waitFor();
  console.log('PASS Koleksi publik tidak memakai materi latihan atau kandidat sebagai bukti');

  await page.locator('.nav-item[data-view="sources"]').click();
  await page.locator('#import-button').click();
  await page.locator('[name="title"]').fill('Fixture browser — bukan statistik resmi');
  await page.locator('[name="publisher"]').fill('Pengujian otomatis');
  await page.locator('[name="sourceUrl"]').fill('https://example.org/browser-fixture');
  await page.locator('#file-input').setInputFiles({name:'uji.csv',mimeType:'text/csv',buffer:Buffer.from('indicator,year,region,value,unit\nPenduduk latihan,2024,Wilayah Uji,321,orang\n')});
  await page.locator('#save-source').click();
  await page.locator('#review-form').waitFor();
  assert.match(await page.locator('.document-content').innerText(),/321/);
  await page.locator('[name="confirmed"]').check();
  await page.locator('[name="reviewer"]').fill('Penguji browser');
  await page.locator('#verify-button').click();
  await page.locator('#withdraw-source').waitFor();
  await page.getByText('Penguji browser',{exact:true}).waitFor();
  await page.locator('.dialog-header .close-dialog').click();
  await page.locator('.nav-item[data-view="chat"]').click();
  await page.locator('#question').fill('Berapa penduduk latihan di Wilayah Uji tahun 2024?');
  await page.locator('#send-button').click();
  await page.getByText('Penduduk latihan di Wilayah Uji pada tahun 2024: 321 orang.',{exact:true}).waitFor();
  assert.match(await page.locator('#messages').innerText(),/Baris 2/);
  await page.screenshot({path:'.artifacts/asisten-data-jawaban.png',fullPage:true});
  console.log('PASS Impor CSV lewat UI → review → verifikasi → jawaban angka dengan lokasi baris');

  await page.locator('.nav-item[data-view="sources"]').click();
  await page.locator('#source-search').fill('Fixture browser');
  await page.locator('.source-row').getByRole('button').click();
  await page.locator('#withdraw-source').click();
  await page.locator('#dialog-content .badge.withdrawn').waitFor();
  await page.locator('.dialog-header .close-dialog').click();
  await page.locator('.nav-item[data-view="chat"]').click();
  await page.locator('#question').fill('Berapa penduduk latihan di Wilayah Uji tahun 2024?');
  await page.locator('#send-button').click();
  await page.getByText('Saya belum menemukan nilai terverifikasi yang cocok',{exact:false}).waitFor();
  console.log('PASS Sumber dinonaktifkan langsung dikeluarkan dari jawaban baru');

  const mobile = await browser.newPage({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});
  mobile.on('pageerror',error => errors.push(error.message));
  await mobile.goto(base+'/workspace'); await mobile.locator('#nav-count').filter({hasText:'6'}).waitFor({state:'attached'});
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await mobile.screenshot({path:'.artifacts/asisten-data-mobile.png',fullPage:true});
  await mobile.locator('.prompt-card[data-prompt*="metadata"]').click();
  await mobile.locator('.excerpts li').first().waitFor();
  await mobile.locator('.nav-item[data-view="sources"]').click();
  await mobile.locator('#import-button').waitFor({state:'visible'});
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await mobile.locator('.nav-item[data-view="pipeline"]').click();
  await mobile.locator('#model-badge').filter({hasText:'Ollama belum berjalan'}).waitFor();
  assert.equal(await mobile.locator('#use-model').isDisabled(),true);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  console.log('PASS Mobile 390px: percakapan, navigasi, koleksi, pengaturan, tanpa overflow');
  const portal=store.portal;
  portal.putItem({url:'https://satudata.depok.go.id/User/detail_dataset/fixture-anak',title:'Jumlah Anak Penyandang Disabilitas',section:'dataset',publisher:'Instansi pengujian',description:'Entri katalog pengujian; isi belum dibaca.',discoveredFrom:'https://satudata.depok.go.id/User/dataset'});
  await mobile.locator('.nav-item[data-view="portal"]').click();
  await mobile.locator('#portal-stats').filter({hasText:'Lampiran belum diekstrak'}).waitFor();
  await mobile.locator('#portal-query').fill('anak disabilitas');
  await mobile.locator('#portal-items .source-row').filter({hasText:'Jumlah Anak Penyandang Disabilitas'}).waitFor();
  await mobile.locator('#portal-items .icon-button').first().click();
  await mobile.locator('#dialog-content .verification-warn').filter({hasText:'Inventaris portal'}).waitFor();
  assert.equal(await mobile.locator('#verify-button').count(),0);
  await mobile.locator('.dialog-header .close-dialog').click();
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log('PASS Cakupan portal mobile: pencarian inventaris, status katalog, tanpa verifikasi palsu atau overflow');

  await page.goto(base+'/chat');
  await page.locator('#portal-coverage').waitFor({state:'visible'});
  await page.locator('#scope-select').selectOption('verified');
  await page.locator('#question').fill('Ada data anak disabilitas?');await page.locator('#send-button').click();
  await page.locator('.message-assistant .message-text').last().filter({hasText:'Saya menemukan entri terkait'}).waitFor();
  assert.match(await page.locator('.message-assistant').last().innerText(),/Terdaftar di portal/);
  await page.locator('#question').fill('Buatkan resep nasi goreng');await page.locator('#send-button').click();
  await page.locator('.message-assistant .message-text').last().filter({hasText:'khusus membantu pencarian'}).waitFor();
  assert.equal(await page.locator('.message-assistant').last().locator('.answer-source').count(),0);
  console.log('PASS Full chat: menemukan sumber portal dan menolak pertanyaan luar ruang lingkup');
  assert.deepEqual(errors,[]);
  console.log('PASS Tidak ada pageerror atau console error. Screenshot tersimpan di .artifacts/');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve)); store.close();
}
