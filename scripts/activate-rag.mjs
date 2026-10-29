import {writeFile,mkdir} from 'node:fs/promises';
import {createStore} from '../server/store.js';
import {modelConfig,modelReady,embeddingsReady,modelStatus,providerError} from '../server/model.js';
import {indexCorpus} from '../server/indexing.js';
import {answerQuestion} from '../server/chat.js';

const local=(code,message)=>Object.assign(new Error(message),{code,local:true});
const store=createStore(),config=modelConfig();
const report={createdAt:new Date().toISOString(),provider:config.provider,model:config.chatModel,embeddingModel:config.embeddingModel,testKind:'live_provider_required',llmResponseObserved:false,ok:false,cases:[]};
try {
  const status=await modelStatus(config);
  report.status={online:status.online,chatReady:status.chatReady,embeddingReady:status.embeddingReady,installedModels:status.models};
  if(config.provider==='ollama') {
    if(!status.online)throw local('ollama_offline',`Ollama tidak berjalan di ${config.baseUrl}. Jalankan Ollama lalu ulangi.`);
    if(!config.chatModel)throw local('missing_chat_model','OLLAMA_CHAT_MODEL belum diisi pada .env.');
    if(!status.chatReady)throw local('missing_chat_model',`Model jawaban "${config.chatModel}" belum terpasang. Jalankan: ollama pull ${config.chatModel}`);
    if(!embeddingsReady(config))throw local('missing_embedding_model','OLLAMA_EMBED_MODEL belum diisi pada .env.');
    if(!status.embeddingReady)throw local('missing_embedding_model',`Model embedding "${config.embeddingModel}" belum terpasang. Jalankan: ollama pull ${config.embeddingModel}`);
  } else if(!modelReady(config)) throw Object.assign(new Error('API key belum tersedia.'),{code:'missing_key'});
  if(!embeddingsReady(config)) throw Object.assign(new Error('Konfigurasi embedding belum tersedia.'),{code:'missing_key'});

  report.index=await indexCorpus(store,config,{scope:'verified'});
  const cases=[
    {question:'Apa itu metadata?',expected:'generated'},
    {question:'Apa rumus persentase penanganan sampah?',expected:'generated'},
    {question:'Berapa persentase penanganan sampah di Kota Depok tahun 2025?',expected:'structured',contains:'53,09'},
    {question:'Berapa jumlah penduduk Kota Depok tahun 2099?',expected:'insufficient_evidence'},
  ];
  for(const item of cases) {
    const answer=await answerQuestion(store,{question:item.question,scope:'verified',useModel:true},config);
    if(['generated','model-assisted'].includes(answer.mode))report.llmResponseObserved=true;
    // Uji ini harus membuktikan model benar-benar menyusun jawaban. Fallback ke
    // pemilihan kutipan (model-assisted) tidak dihitung lulus, sesuai aturan README.
    const generatedOk=answer.mode==='generated';
    const passed=(item.expected==='structured'?answer.method==='structured' && answer.status==='answered':item.expected==='insufficient_evidence'?answer.status==='insufficient_evidence':generatedOk && answer.status==='answered') && (!item.contains || answer.answer.includes(item.contains));
    report.cases.push({question:item.question,passed,status:answer.status,mode:answer.mode,method:answer.method,answer:answer.answer,sources:answer.sources.map(source=>({title:source.title,url:source.url,row:source.rowNumber})),usage:answer.usage,notice:answer.notice});
    console.log(JSON.stringify({question:item.question,passed,mode:answer.mode,method:answer.method,answer:answer.answer,notice:answer.notice}));
  }
  report.ok=report.cases.every(item=>item.passed);
  if(!report.ok)process.exitCode=1;
}catch(error){report.error=error.local?{code:error.code,message:error.message}:providerError(error);process.exitCode=2;console.log(JSON.stringify({ok:false,error:report.error}));}
finally{await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/rag-live-latest.json',JSON.stringify(report,null,2));store.close();}
