import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';

// Opt-in test of the running local app and real Ollama. No source imports,
// reviews or withdrawals; only public questions and normal inference logs.
const base=`http://127.0.0.1:${process.env.PORT || 3000}`;
const report={createdAt:new Date().toISOString(),testKind:'live_ollama_browser',ok:false,cases:[]};
const errors=[];
let browser;
mkdirSync('.artifacts',{recursive:true});
try {
  const statusResponse=await fetch(base+'/api/status',{signal:AbortSignal.timeout(10000)});
  assert.ok(statusResponse.ok,'Jalankan npm start terlebih dahulu.');
  const status=await statusResponse.json();
  assert.equal(status.model.provider,'ollama','Uji ini hanya untuk chatbot Ollama.');
  assert.ok(status.model.chatReady && status.model.embeddingReady,'Pastikan Ollama dan kedua model siap.');
  assert.ok(status.rag.index.total>0 && status.rag.index.indexed===status.rag.index.total,'Jalankan npm run rag:activate untuk menyiapkan indeks publik.');
  const executablePath=process.env.BROWSER_PATH;
  if(executablePath && !existsSync(executablePath))throw new Error('BROWSER_PATH tidak ditemukan.');
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(base+'/chat');
  await page.locator('#assistant-mode').filter({hasText:'Layanan AI dikonfigurasi'}).waitFor();
  await page.locator('#scope-select').selectOption('verified');

  const cases=[
    {question:'Apa itu metadata?',mode:'generated',contains:/Metadata/i},
    {question:'Apa rumus persentase penanganan sampah?',mode:'generated',contains:/100\s*%/},
    {question:'Apa satuan persentase penanganan sampah?',mode:'generated',contains:/persen/i},
    {question:'Berapa persentase penanganan sampah di Kota Depok tahun 2025?',mode:'extractive',contains:/2025: 53,09 persen/},
    {question:'Kalau 2024?',mode:'extractive',contains:/2024: 39 persen/},
    {question:'Berapa jumlah penduduk Kota Depok tahun 2099?',status:'insufficient_evidence'},
  ];
  for(const item of cases) {
    await page.locator('#question').fill(item.question);
    const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chat' && response.request().method()==='POST',{timeout:115000});
    await page.locator('#send-button').click();
    const response=await pending;
    assert.ok(response.ok());
    const answer=await response.json();
    report.cases.push({question:item.question,status:answer.status,mode:answer.mode,provider:answer.provider,method:answer.method,elapsedMs:answer.elapsedMs,answer:answer.answer});
    assert.equal(answer.status,item.status || 'answered');
    if(item.mode)assert.equal(answer.mode,item.mode,'Fallback tidak dihitung sebagai generasi berhasil.');
    if(item.contains)assert.match(answer.answer,item.contains);
    if(item.mode==='generated') {
      assert.equal(answer.provider,'ollama');assert.equal(answer.method,'hybrid');
      assert.ok(answer.sources.length>0);assert.match(answer.answer,/\[1\]/);
    }
    await page.locator('.pending-answer').waitFor({state:'hidden'});
    assert.equal(await page.locator('.message-assistant .message-text').last().innerText(),answer.answer);
    assert.equal(await page.locator('#send-button').isEnabled(),true);
    console.log(`PASS ${item.question} | ${answer.mode} | ${answer.elapsedMs} ms`);
  }
  await page.locator('.cite-button').first().click();
  await page.locator('#source-dialog[open]').waitFor();
  await page.screenshot({path:'.artifacts/live-ollama-source.png'});
  await page.locator('#close-source-dialog').click();
  await page.reload();
  await page.locator('.message-assistant .message-text').last().waitFor();
  assert.equal(await page.locator('.message-assistant .message-text').count(),cases.length);
  await page.screenshot({path:'.artifacts/live-ollama-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'.artifacts/live-ollama-mobile.png'});
  assert.deepEqual(errors,[]);
  report.ok=true;
  console.log('PASS Sumber asli, riwayat setelah reload, mobile tanpa overflow, browser bersih.');
} catch(error) {
  report.error=error.message;
  process.exitCode=1;
  console.error('FAIL',error.message);
} finally {
  if(browser)await browser.close();
  writeFileSync('.artifacts/live-browser-latest.json',JSON.stringify(report,null,2));
}
