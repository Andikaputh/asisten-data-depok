import { embedTexts, embeddingIdentity, embeddingsReady } from './model.js';

export async function indexCorpus(store,config,{force=false,scope='all'}={}) {
  if (!embeddingsReady(config)) throw Object.assign(new Error('Konfigurasi embedding belum tersedia. Isi API key pada .env atau konfigurasikan model lokal.'),{code:'missing_key'});
  const eligible = scope==='all' ? [...store.activeChunks('verified'),...store.activeChunks('demo')] : store.activeChunks(scope);
  const identity = embeddingIdentity(config);
  const chunks = eligible.filter(chunk=>chunk.kind!=='csv' && (force || !chunk.vector || chunk.embeddingModel!==identity));
  if (!chunks.length) return {indexed:0,model:identity,total:eligible.filter(chunk=>chunk.kind!=='csv').length};
  const vectors=[];
  for(let i=0;i<chunks.length;i+=16) vectors.push(...await embedTexts(chunks.slice(i,i+16).map(chunk=>`${chunk.title}\n${chunk.text}`),config));
  if (vectors.length!==chunks.length || new Set(vectors.map(vector=>vector.length)).size!==1) throw new Error('Dimensi embedding tidak konsisten.');
  // Ignore withdrawn documents even when status changed during the network requests.
  const current = chunks.map((chunk,index)=>({chunk,vector:vectors[index]})).filter(({chunk})=>['verified','demo'].includes(store.get(chunk.documentId)?.status));
  store.db.exec('BEGIN');
  try {
    for(const {chunk,vector} of current) store.setVector(chunk.id,vector,identity);
    store.db.exec('COMMIT');
  } catch(error) {store.db.exec('ROLLBACK');throw error;}
  return {indexed:current.length,model:identity,total:eligible.filter(chunk=>chunk.kind!=='csv').length};
}

export function indexStatus(store,config) {
  const identity=embeddingIdentity(config),chunks=store.activeChunks('verified').filter(chunk=>chunk.kind!=='csv');
  return {model:identity,total:chunks.length,indexed:chunks.filter(chunk=>chunk.vector && chunk.embeddingModel===identity).length};
}
