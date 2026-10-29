import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createStore } from './store.js';
import { UserError, validateImport } from './import.js';
import { answerQuestion } from './chat.js';
import { modelConfig, modelStatus, providerError } from './model.js';
import { indexCorpus, indexStatus } from './indexing.js';
import { syncPublicSources, importPublicWasteCsv } from './public-sources.js';

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.csv': 'text/csv; charset=utf-8' };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new UserError('Gunakan Content-Type application/json.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new UserError('Permintaan terlalu besar; maksimal 2 MB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new UserError('JSON tidak valid.'); }
}

function summary(document) {
  const { content, ...rest } = document;
  return { ...rest, contentLength: content.length };
}

export function createApp({ store = createStore(), config:fixedConfig } = {}) {
  let reindexing = false, syncing = false, chatRequests = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const config=fixedConfig || modelConfig();
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) throw new UserError('Server ini hanya menerima akses lokal.', 403);
      const url = new URL(req.url, `http://${host}`);
      const { pathname } = url;
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new UserError('Origin tidak diizinkan.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new UserError('Permintaan lintas situs tidak diizinkan.', 403);
      if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, version: '0.2.0' });
      if (pathname === '/api/status' && req.method === 'GET') {
        const documents = store.list();
        const counts = Object.fromEntries(['candidate','unverified','verified','demo','withdrawn'].map(status => [status, documents.filter(d => d.status === status).length]));
        return json(res, 200, { counts, observations: store.observations().length, chunks: store.activeChunks('verified').length, model: await modelStatus(config), reindexing,rag:{index:indexStatus(store,config),recentRuns:store.recentRuns()},syncing });
      }
      if (pathname === '/api/sources' && req.method === 'GET') return json(res, 200, { sources: store.list().map(summary) });
      if (pathname === '/api/export' && req.method === 'GET') {
        res.setHeader('Content-Disposition', 'attachment; filename="koleksi-asisten-data-depok.json"');
        return json(res, 200, { version: 1, exportedAt: new Date().toISOString(), documents: store.list(), observations: store.observations() });
      }
      if (pathname === '/api/sources' && req.method === 'POST') {
        if (store.list().filter(d => !['candidate','demo','withdrawn'].includes(d.status)).length >= 100) throw new UserError('Batas prototipe 100 dokumen aktif tercapai.');
        const input = validateImport(await readJson(req));
        const result = store.add(input.document, input.observations);
        return json(res, result.duplicate ? 200 : 201, { source: summary(result.document), duplicate: result.duplicate, observations: input.observations.length });
      }
      const documentMatch = pathname.match(/^\/api\/sources\/([a-zA-Z0-9-]+)(?:\/(verify|withdraw))?$/);
      if (documentMatch) {
        const [, id, action] = documentMatch;
        const document = store.get(id);
        if (!document) throw new UserError('Sumber tidak ditemukan.', 404);
        if (!action && req.method === 'GET') return json(res, 200, { source: document });
        if (action === 'verify' && req.method === 'POST') {
          if (document.status !== 'unverified') throw new UserError('Hanya dokumen impor yang belum diperiksa dapat diverifikasi.');
          const body = await readJson(req);
          if (body.confirmed !== true || typeof body.reviewer !== 'string' || body.reviewer.trim().length < 3 || body.reviewer.length > 120) throw new UserError('Konfirmasi pemeriksaan dan isi nama peninjau minimal tiga karakter.');
          return json(res, 200, { source: summary(store.verify(id, body.reviewer.trim())) });
        }
        if (action === 'withdraw' && req.method === 'POST') {
          await readJson(req);
          if (!['unverified','verified'].includes(document.status)) throw new UserError('Sumber ini tidak dapat dinonaktifkan.');
          return json(res, 200, { source: summary(store.withdraw(id)) });
        }
      }
      if (pathname === '/api/chat' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000) throw new UserError('Pertanyaan wajib diisi, maksimal 2000 karakter.');
        if (body.scope && !['verified','demo'].includes(body.scope)) throw new UserError('Lingkup koleksi tidak valid.');
        if (body.previousQuestion !== undefined && (typeof body.previousQuestion !== 'string' || body.previousQuestion.length > 2000)) throw new UserError('Konteks pertanyaan tidak valid.');
        if (chatRequests >= 3) throw new UserError('Sedang memproses pertanyaan lain. Coba lagi sebentar.', 429);
        chatRequests++;
        try { return json(res, 200, await answerQuestion(store, { question: body.question.trim(), scope: body.scope || 'verified', useModel: body.useModel !== false, previousQuestion: body.previousQuestion || '' }, config)); }
        finally { chatRequests--; }
      }
      if (pathname === '/api/reindex' && req.method === 'POST') {
        await readJson(req);
        if (!config.embeddingModel || config.provider==='openai' && !config.apiKey) throw new UserError('Konfigurasi embedding belum siap. Isi OPENAI_API_KEY di .env atau jalankan Ollama dengan model embedding.');
        if (reindexing) throw new UserError('Pengindeksan sedang berjalan.', 409);
        reindexing = true;
        try {
          return json(res, 200, await indexCorpus(store,config));
        } finally { reindexing = false; }
      }
      if(pathname==='/api/public-sources/sync' && req.method==='POST') {
        const body=await readJson(req);
        if(syncing)throw new UserError('Pengambilan sumber sedang berjalan.',409);
        syncing=true;
        try {
          const results=await syncPublicSources(store);
          if(body.includeCsv===true){try{results.push(await importPublicWasteCsv(store));}catch(error){results.push({key:'observasi-sampah',error:error.message});}}
          return json(res,200,{results,note:'Sumber baru berstatus belum diperiksa. Tinjau isi sebelum digunakan sebagai bukti.'});
        } finally {syncing=false;}
      }
      if(pathname==='/api/rag/check' && req.method==='POST') {
        await readJson(req);
        if(config.provider==='openai' && !config.apiKey)throw new UserError('OPENAI_API_KEY belum diisi pada .env. Kunci tidak perlu dikirim melalui chat.');
        if(!store.activeChunks('verified').some(chunk=>chunk.kind==='metadata'))throw new UserError('Belum ada metadata publik terverifikasi untuk pengujian.');
        if(reindexing)throw new UserError('Pengindeksan sedang berjalan.',409);
        reindexing=true;
        try {
          const index=await indexCorpus(store,config,{scope:'verified'});
          const answer=await answerQuestion(store,{question:'Apa rumus persentase penanganan sampah?',scope:'verified',useModel:true},config);
          return json(res,200,{ok:answer.status==='answered' && (answer.mode==='generated' || answer.mode==='model-assisted'),index,answer});
        }catch(error){const failure=providerError(error);return json(res,502,{error:failure.message,code:failure.code});}
        finally{reindexing=false;}
      }
      if (pathname.startsWith('/api/')) throw new UserError('Endpoint atau metode tidak ditemukan.', 404);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new UserError('Metode tidak diizinkan.', 405);
      const files = { '/': 'index.html', '/chat': 'chat.html', '/chat/': 'chat.html', '/workspace': 'workspace.html', '/full-chat.js': 'full-chat.js', '/full-chat.css': 'full-chat.css', '/app.js': 'app.js', '/portal.js': 'portal.js', '/portal.css': 'portal.css', '/styles.css': 'styles.css', '/chat-theme.css': 'chat-theme.css', '/favicon.svg': 'favicon.svg', '/contoh-format.csv': 'contoh-format.csv', '/assets/logo-sadepok.png': 'assets/logo-sadepok.png', '/assets/hero-illustration.svg': 'assets/hero-illustration.svg' };
      const file = files[pathname];
      if (!file) throw new UserError('Halaman tidak ditemukan.', 404);
      const content = await readFile(join(publicDirectory, file));
      res.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) {
        const status = error instanceof UserError ? error.status : 500;
        if (status === 500) console.error('[request error]', providerError(error).code);
        json(res, status, { error: status === 500 ? 'Proses gagal. Periksa server atau coba lagi.' : error.message });
      } else res.end();
    }
  });
  server.requestTimeout = 120_000;
  return { server, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, store } = createApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`Asisten Data Depok siap: http://127.0.0.1:${server.address().port}`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} sedang dipakai. Ubah PORT di .env.` : error.message); process.exitCode = 1; store.close(); });
  const stop = () => server.close(() => { store.close(); process.exit(0); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
