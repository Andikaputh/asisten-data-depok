import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.js';
import {answerQuestion} from '../server/chat.js';
import {indexCorpus,indexStatus} from '../server/indexing.js';
import {validateGroundedOutput} from '../server/grounding.js';
import {modelStatus,providerError,embeddingIdentity,modelConfig} from '../server/model.js';
import {parsePublicMetadata,normalizeDepokCsv} from '../server/public-sources.js';
import {createApp} from '../server/index.js';

const content='Dataset: Persentase penanganan sampah\nKonsep: Persentase penanganan sampah\nInterpretasi: Semakin tinggi persentase sampah yang ditangani, semakin baik pengelolaan sampah.\nMetode / Rumus Perhitungan: (Volume sampah ditangani / volume timbulan sampah) x 100%\nSatuan: Persen';
const doc={title:'Persentase penanganan sampah',publisher:'Instansi uji',kind:'metadata',status:'verified',sourceUrl:'https://example.org/metadata',content};
const question='Apa rumus persentase penanganan sampah?';
const offline={provider:'openai',apiKey:'',chatModel:'fixture',embeddingModel:'embed-fixture',baseUrl:'https://api.openai.com/v1'};

async function mockOpenAI({invalid=false,apiStatus=200,onGenerate}={}) {
  const requests=[];
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const body=text?JSON.parse(text):{};requests.push({url:req.url,body});res.setHeader('Content-Type','application/json');
    if(apiStatus!==200){res.writeHead(apiStatus);return res.end(JSON.stringify({error:{message:'sk-fixture-must-never-leak',type:'test_error',code:'test_error'}}));}
    if(req.url==='/v1/embeddings')return res.end(JSON.stringify({object:'list',data:body.input.map((item,index)=>({object:'embedding',index,embedding:[1,0,0]})),model:body.model,usage:{prompt_tokens:10,total_tokens:10}}));
    if(req.url==='/v1/responses') {
      const input=body.input.at(-1),prompt=typeof input.content==='string'?input.content:input.content.map(part=>part.text || '').join('');
      const evidence=JSON.parse(prompt).evidence;
      const selected=evidence.find(item=>item.text.includes('Metode / Rumus')) || evidence[0];
      const quote=selected.text.split('\n').find(line=>line.startsWith('Metode / Rumus')) || selected.text;
      const output={status:'answered',claims:[{text:quote,evidenceIds:[invalid?'forged-id':selected.id],quotes:[{evidenceId:invalid?'forged-id':selected.id,quote}]}]};
      onGenerate?.();
      return res.end(JSON.stringify({id:'resp_fixture',object:'response',created_at:1,model:body.model,status:'completed',output:[{type:'message',id:'msg_fixture',role:'assistant',content:[{type:'output_text',text:JSON.stringify(output),annotations:[]}]}],usage:{input_tokens:32,output_tokens:24,total_tokens:56}}));
    }
    res.writeHead(404);res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {requests,config:{provider:'openai',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'sk-fixture-must-never-leak',chatModel:'gpt-5.4-mini',embeddingModel:'embed-fixture'},close:()=>new Promise(resolve=>server.close(resolve))};
}

// Ollama speaks the OpenAI-compatible chat API plus a native /api/embed route.
// The mock mirrors both so the local path is exercised without a real daemon.
async function mockOllama({composeMalformed=false,composeAnswer='Rumus perhitungannya mengalikan hasil bagi volume sampah dengan 100%.',selectAll=false,onCompose}={}) {
  const requests=[];
  const textOf=message=>typeof message.content==='string'?message.content:(message.content||[]).map(part=>part.text||'').join('');
  const server=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const body=text?JSON.parse(text):{};requests.push({url:req.url,body});res.setHeader('Content-Type','application/json');
    if(req.url==='/api/embed')return res.end(JSON.stringify({embeddings:body.input.map(()=>[1,0,0])}));
    if(req.url==='/v1/chat/completions') {
      const messages=body.messages||[];
      const system=textOf(messages.find(message=>message.role==='system')||{});
      const user=textOf(messages.find(message=>message.role==='user')||{});
      let content;
      if(/pemilih bukti/i.test(system)) {
        content=JSON.stringify({ids:JSON.parse(user).evidence.slice(0,selectAll?3:1).map(item=>item.id)});
      } else if(composeMalformed) {
        content='bukan json';
      } else {
        onCompose?.();
        content=JSON.stringify({answer:composeAnswer});
      }
      return res.end(JSON.stringify({id:'chatcmpl-fixture',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20}}));
    }
    res.writeHead(404);res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {requests,config:{provider:'ollama',baseUrl:`http://127.0.0.1:${server.address().port}`,chatModel:'qwen2.5:3b-instruct',embeddingModel:'bge-m3'},close:()=>new Promise(resolve=>server.close(resolve))};
}

test('pemeriksa klaim menolak ID palsu, kutipan palsu, angka baru, dan URL model',()=>{
  const evidence=[{id:'a',text:'Nilai pada sumber tahun 2025 adalah 53,09 persen.'}];
  const good={status:'answered',claims:[{text:'Nilai pada tahun 2025 adalah 53,09 persen.',evidenceIds:['a'],quotes:[{evidenceId:'a',quote:evidence[0].text}]}]};
  assert.equal(validateGroundedOutput(good,evidence).status,'answered');
  const clone=()=>structuredClone(good);
  let value=clone();value.claims[0].evidenceIds=['fake'];assert.throws(()=>validateGroundedOutput(value,evidence),/rujukan/);
  value=clone();value.claims[0].quotes[0].quote='Kutipan yang tidak pernah ada dalam sumber.';assert.throws(()=>validateGroundedOutput(value,evidence),/Kutipan/);
  value=clone();value.claims[0].text='Nilainya 999 persen.';assert.throws(()=>validateGroundedOutput(value,evidence),/Angka/);
  value=clone();value.claims[0].text='Buka https://fake.example untuk hasil.';assert.throws(()=>validateGroundedOutput(value,evidence),/Teks/);
  assert.throws(()=>validateGroundedOutput({...good,status:'insufficient_evidence'},evidence),/tanpa jawaban/);
});

test('konfigurasi .env dibaca ulang tanpa restart dan tidak perlu diekspos melalui HTTP',()=>{
  const previous=process.cwd(),directory=mkdtempSync(join(tmpdir(),'depok-config-test-'));
  try{process.chdir(directory);writeFileSync('.env','RAG_PROVIDER=openai\nOPENAI_API_KEY=\n');assert.equal(modelConfig().apiKey,'');writeFileSync('.env','RAG_PROVIDER=openai\nOPENAI_API_KEY=sk-local-test-only\nOPENAI_CHAT_MODEL=gpt-5.4-mini\n');assert.equal(modelConfig().apiKey,'sk-local-test-only');assert.equal(modelConfig().chatModel,'gpt-5.4-mini');}
  finally{process.chdir(previous);unlinkSync(join(directory,'.env'));rmdirSync(directory);}
});

test('alur SDK OpenAI: embedding → hybrid → Responses structured output → klaim dan sumber',async()=>{
  const api=await mockOpenAI(),store=createStore(':memory:',false);
  try {
    store.add(doc);
    const indexed=await indexCorpus(store,api.config,{scope:'verified'});assert.ok(indexed.indexed>0);
    assert.equal(indexStatus(store,api.config).indexed,indexStatus(store,api.config).total);
    assert.equal((await indexCorpus(store,api.config)).indexed,0);
    const response=await answerQuestion(store,{question,scope:'verified',useModel:true},api.config);
    assert.equal(response.mode,'generated');assert.equal(response.status,'answered');assert.equal(response.method,'hybrid');assert.equal(response.sources.length,1);assert.equal(response.usage.inputTokens,32);
    assert.match(response.answer,/100%/);assert.match(response.answer,/\[1\]/);
    assert.ok(store.get(response.sources[0].documentId).content.includes(response.excerpts[0].text));
    const request=api.requests.find(item=>item.url==='/v1/responses').body;
    assert.equal(request.store,false);assert.equal(request.text.format.type,'json_schema');assert.equal(request.reasoning.effort,'none');
    assert.equal(store.recentRuns()[0].status,'success');
    assert.equal(embeddingIdentity(api.config),'openai:embed-fixture');
  }finally{store.close();await api.close();}
});

test('alur Ollama lokal: embedding → hybrid → pilih bukti → susun kalimat bersumber',async()=>{
  const api=await mockOllama(),store=createStore(':memory:',false);
  try {
    store.add(doc);
    const indexed=await indexCorpus(store,api.config,{scope:'verified'});assert.ok(indexed.indexed>0);
    const response=await answerQuestion(store,{question,scope:'verified',useModel:true},api.config);
    assert.equal(response.mode,'generated');assert.equal(response.status,'answered');assert.equal(response.method,'hybrid');assert.equal(response.provider,'ollama');
    assert.equal(response.sources.length,1);assert.match(response.answer,/100%/);assert.match(response.answer,/\[1\]/);
    assert.equal(response.excerpts.length,1);
    const composition=api.requests.find(item=>/penulis jawaban/i.test(JSON.stringify(item.body.messages||[])));
    assert.ok(composition);
    assert.ok(JSON.parse(composition.body.messages.at(-1).content).quotes.every(item=>typeof item==='string'));
  }finally{store.close();await api.close();}
});

test('kalimat model lokal yang rusak tidak ditampilkan; kutipan sumber tetap dipakai',async()=>{
  const api=await mockOllama({composeMalformed:true}),store=createStore(':memory:',false);
  try {
    store.add(doc);await indexCorpus(store,api.config,{scope:'verified'});
    const response=await answerQuestion(store,{question,scope:'verified',useModel:true},api.config);
    assert.equal(response.mode,'model-assisted');assert.equal(response.status,'answered');assert.match(response.notice,/tidak dapat menyusun kalimat/);
    assert.ok(store.recentRuns().some(run=>run.errorCode==='invalid_model_output'));
  }finally{store.close();await api.close();}
});

test('angka baru dari model lokal ditolak dan kembali ke kutipan',async()=>{
  const api=await mockOllama({composeAnswer:'Persentase penanganan sampah mencapai 999 persen.'}),store=createStore(':memory:',false);
  try {
    store.add(doc);await indexCorpus(store,api.config,{scope:'verified'});
    const response=await answerQuestion(store,{question,scope:'verified',useModel:true},api.config);
    assert.equal(response.mode,'model-assisted');assert.ok(!response.answer.includes('999'));
    assert.ok(store.recentRuns().some(run=>run.errorCode==='invalid_evidence'));
  }finally{store.close();await api.close();}
});

test('kalimat lokal yang terlalu pendek, URL, dan permintaan kunci tidak ditampilkan',async()=>{
  for(const composeAnswer of ['Persentase','Informasi selengkapnya ada di https://example.org/hasil.','Silakan memberikan API key untuk menjawab pertanyaan.']) {
    const api=await mockOllama({composeAnswer}),store=createStore(':memory:',false);
    try {
      store.add(doc);
      const response=await answerQuestion(store,{question,scope:'verified',useModel:true},api.config);
      assert.equal(response.mode,'model-assisted');
      assert.ok(!response.answer.includes(composeAnswer));
      assert.match(response.notice,/tidak dapat menyusun kalimat/);
    }finally{store.close();await api.close();}
  }
});

test('penarikan sebagian bukti selama komposisi Ollama membatalkan seluruh kalimat',async()=>{
  const store=createStore(':memory:',false);
  store.add({...doc,content:'Konsep: Persentase penanganan sampah menunjukkan bagian sampah yang dapat ditangani.'});
  const {document}=store.add({...doc,title:'Rumus persentase penanganan sampah',sourceUrl:'https://example.org/rumus',content:'Metode / Rumus Perhitungan: (Volume sampah ditangani / volume timbulan sampah) x 100%'});
  const api=await mockOllama({selectAll:true,onCompose:()=>store.withdraw(document.id)});
  try {
    const response=await answerQuestion(store,{question,scope:'verified',useModel:true},api.config);
    assert.equal(response.status,'insufficient_evidence');assert.deepEqual(response.sources,[]);
    assert.equal(response.excerpts,undefined);assert.ok(!response.answer.includes('100%'));
    const selection=api.requests.find(item=>item.url==='/v1/chat/completions').body;
    assert.equal(JSON.parse(selection.messages.at(-1).content).evidence.length,2);
  }finally{store.close();await api.close();}
});

test('jawaban model dengan bukti palsu menjadi kutipan lokal yang ditandai',async()=>{
  const api=await mockOpenAI({invalid:true}),store=createStore(':memory:',false);
  try{store.add(doc);const response=await answerQuestion(store,{question,scope:'verified',useModel:true},api.config);assert.equal(response.mode,'extractive');assert.match(response.notice,/pemeriksaan rujukan/);assert.equal(store.recentRuns()[0].errorCode,'invalid_evidence');assert.ok(response.sources.every(source=>source.url==='https://example.org/metadata'));}
  finally{store.close();await api.close();}
});

test('penarikan sumber selama panggilan LLM tidak meloloskan bukti lama lewat fallback',async()=>{
  const store=createStore(':memory:',false),{document}=store.add(doc);
  const api=await mockOpenAI({onGenerate:()=>store.withdraw(document.id)});
  try{const response=await answerQuestion(store,{question,scope:'verified',useModel:true},api.config);assert.equal(response.status,'insufficient_evidence');assert.equal(response.sources.length,0);assert.equal(response.excerpts,undefined);}
  finally{store.close();await api.close();}
});

test('API key kosong, kuota, dan autentikasi gagal tidak dipresentasikan sebagai jawaban LLM',async()=>{
  const store=createStore(':memory:',false);store.add(doc);
  try{const response=await answerQuestion(store,{question,scope:'verified',useModel:true},offline);assert.equal(response.mode,'extractive');assert.match(response.notice,/Layanan AI belum diaktifkan/);}
  finally{store.close();}
  const api=await mockOpenAI({apiStatus:401}),other=createStore(':memory:',false);other.add(doc);
  try{const response=await answerQuestion(other,{question,scope:'verified',useModel:true},api.config);assert.equal(response.mode,'extractive');assert.match(response.notice,/API key ditolak/);assert.ok(!JSON.stringify(response).includes(api.config.apiKey));assert.equal(other.recentRuns()[0].errorCode,'authentication');}
  finally{other.close();await api.close();}
  assert.equal(providerError({statusCode:429}).code,'quota_or_rate_limit');
});

test('diagnosis HTTP 429 membedakan saldo, batas akun, dan rate limit tanpa membocorkan body',()=>{
  const diagnose=(code,type)=>providerError({statusCode:429,responseBody:JSON.stringify({error:{code,type,message:'sk-fixture-must-never-leak'}})});
  assert.equal(diagnose('credit_balance_exhausted','insufficient_quota').code,'credit_balance_exhausted');
  assert.equal(diagnose('project_spend_limit_exceeded','insufficient_quota').code,'project_spend_limit_exceeded');
  assert.equal(diagnose('insufficient_quota','insufficient_quota').code,'insufficient_quota');
  assert.equal(diagnose('slow_down','rate_limit_error').code,'rate_limit');
  assert.equal(diagnose('rate_limit_exceeded','rate_limit_error').code,'rate_limit');
  assert.equal(providerError({statusCode:429,responseBody:'invalid JSON'}).code,'quota_or_rate_limit');
  assert.ok(!JSON.stringify(diagnose('credit_balance_exhausted','insufficient_quota')).includes('sk-fixture'));
});

test('status dan log HTTP hanya mengekspos konfigurasi, tidak kunci',async()=>{
  const api=await mockOpenAI(),store=createStore(':memory:',false);store.add(doc);
  const {server}=createApp({store,config:api.config});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,scope:'verified'})});assert.equal((await response.json()).mode,'generated');
    const status=await(await fetch(base+'/api/status')).text();assert.ok(!status.includes(api.config.apiKey));assert.ok(!status.includes('"apiKey"'));assert.equal(JSON.parse(status).rag.recentRuns[0].status,'success');
    assert.equal((await modelStatus(api.config)).keyConfigured,true);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();await api.close();}
});

test('normalisasi CSV publik mempertahankan baris, koma desimal, tahun dan satuan',()=>{
  const csv='No;nama_kabupaten_kota;nama_instansi;nama_data;hasil;Tahun; Satuan\n1;Kota Depok;Instansi uji;Penanganan sampah;39,82;2021;persen\n2;Kota Depok;Instansi uji;Penanganan sampah;53,09;2025;persen';
  const result=normalizeDepokCsv(csv,{indicator:'Persentase penanganan sampah'});
  assert.equal(result.observations[0].valueRaw,'39.82');assert.equal(result.observations[1].valueRaw,'53.09');assert.equal(result.observations[1].year,'2025');assert.equal(result.observations[1].rowNumber,3);
  assert.throws(()=>normalizeDepokCsv(csv.replace('39,82','-'),{indicator:'Sampah'}),/pemeriksaan manual/);
});

test('parser metadata publik mempertahankan label, menolak penolakan akses dan URL asing',()=>{
  const html='<html><div class="section-page"><div class="hero-section"><h2>Penanganan sampah Kota Depok</h2><div class="dinas"><h6>Instansi uji</h6></div></div><div id="nav-tabContent"><div class="tab-pane"><h5>Metadata Indikator</h5><table><tr><th>Nama Indikator</th><td>Penanganan sampah</td></tr><tr><th>Satuan</th><td>Persen</td></tr></table></div></div></div><script>doNotExecute()</script></html>';
  const url='https://satudata.depok.go.id/User/detail_dataset/fixture';
  const parsed=parsePublicMetadata(html,url);assert.equal(parsed.status,'unverified');assert.equal(parsed.year,null);assert.match(parsed.content,/Satuan: Persen/);assert.ok(!parsed.content.includes('doNotExecute'));
  assert.throws(()=>parsePublicMetadata('Request Rejected',url),/ditolak/);
  assert.throws(()=>parsePublicMetadata(html,'https://evil.example/dataset'),/diizinkan/);
});

test('pencarian rumus tidak menampilkan rumus indikator lain hanya karena kata umum',async()=>{
  const store=createStore(':memory:',false);store.add(doc);store.add({...doc,title:'Persentase kinerja perangkat daerah',sourceUrl:'https://example.org/kinerja',content:'Konsep: Persentase kinerja perangkat daerah\nMetode / Rumus Perhitungan: Jumlah perangkat daerah / seluruh perangkat daerah x 100%'});
  try{const response=await answerQuestion(store,{question,scope:'verified',useModel:false},offline);assert.ok(response.excerpts[0].text.startsWith('Metode / Rumus'));assert.equal(response.sources.length,1);assert.equal(response.sources[0].title,doc.title);}
  finally{store.close();}
});

test('tindak lanjut tahun mempertahankan indikator, sedangkan pertanyaan baru tidak mewarisi konteks',async()=>{
  const store=createStore(':memory:',false);
  const csv='No;nama_kabupaten_kota;nama_instansi;nama_data;hasil;Tahun;Satuan\n1;Kota Depok;Instansi uji;Penanganan sampah;39;2024;persen\n2;Kota Depok;Instansi uji;Penanganan sampah;53,09;2025;persen';
  const normalized=normalizeDepokCsv(csv,{indicator:'Persentase penanganan sampah'});
  store.add({...doc,kind:'csv',content:normalized.content},normalized.observations);
  try{const first=await answerQuestion(store,{question:'Berapa persentase penanganan sampah di Kota Depok tahun 2025?',scope:'verified'},offline);const next=await answerQuestion(store,{question:'Kalau 2024?',previousQuestion:first.resolvedQuestion,scope:'verified'},offline);assert.equal(next.status,'answered');assert.match(next.answer,/2024: 39 persen/);const other=await answerQuestion(store,{question:'Apa itu metadata?',previousQuestion:next.resolvedQuestion,scope:'verified'},offline);assert.equal(other.resolvedQuestion,'Apa itu metadata?');assert.equal(other.status,'insufficient_evidence');}
  finally{store.close();}
});
