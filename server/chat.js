import { candidateSearch, normalize, rankSentences, retrieve, tokens } from './retrieval.js';
import { embedTexts, selectEvidence, embeddingIdentity, embeddingsReady, modelReady, providerError } from './model.js';
import { generateGroundedAnswer, composeLocalAnswer } from './grounding.js';
import {isOutsidePortal,outsidePortalAnswer,hasPortalContext,hasTopicEvidence,portalNavigation,portalContentAnswer,portalNotFound,portalSuggestionsForNumber,coverageSummary} from './portal-chat.js';

function sourceCard(row, excerpt) {
  return { id: row.id, documentId: row.documentId, title: row.title, url: row.sourceUrl || null, publisher: row.publisher, status: row.status, year: row.year || null, region: row.region || null, retrievedAt: row.retrievedAt, version: row.version, excerpt: excerpt || row.text?.slice(0, 300) || '', rowNumber: row.rowNumber || null };
}

function formatExact(raw) {
  const [integer, fraction] = raw.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction === undefined ? '' : `,${fraction}`);
}

function numericAnswer(store, question) {
  if (/banding|selisih|pertumbuhan|rata.rata|jumlahkan|akumulasi/i.test(question)) return { status: 'insufficient_evidence', answer: 'Perhitungan dan perbandingan lintas baris belum diaktifkan pada versi ini. Saya dapat membaca satu nilai dengan indikator, tahun, wilayah, dan satuan yang jelas.', sources: [] };
  const years = [...new Set(question.match(/\b(?:19|20)\d{2}\b/g) || [])];
  const latest = /terbaru|terakhir|paling baru/i.test(question);
  if (!years.length && !latest) return { status: 'clarify', answer: 'Untuk menjawab angka, tahun observasi berapa yang kamu butuhkan? Sebutkan juga nama indikator dan wilayah lengkap, misalnya Kota Depok atau Kelurahan Depok.', sources: [] };
  if (years.length > 1) return { status: 'clarify', answer: 'Pilih satu tahun terlebih dahulu. Versi ini membaca satu observasi; perbandingan beberapa tahun belum diaktifkan.', sources: [] };
  const q = ` ${normalize(question)} `;
  let rows = store.observations().filter(row => {
    const quantities=new Set(['persentase','jumlah','rasio','tingkat','total','nilai']);
    const indicatorTokens = tokens(row.indicator).filter(token=>!quantities.has(token));
    if (!indicatorTokens.length || !indicatorTokens.every(t => tokens(question).includes(t))) return false;
    if (!q.includes(` ${normalize(row.region)} `)) return false;
    const extraTerms = tokens(question).filter(t => !quantities.has(t) && !tokens(`${row.indicator} ${row.region} ${row.unit}`).includes(t));
    return !extraTerms.length && (latest || years.includes(row.year));
  });
  if (latest && rows.length) { const year = rows.map(row => row.year).sort().at(-1); rows = rows.filter(row => row.year === year); }
  if (!rows.length) return { status: 'insufficient_evidence', answer: 'Saya belum menemukan nilai terverifikasi yang cocok dengan indikator, tahun, dan wilayah lengkap tersebut. Metadata atau judul dataset saja belum cukup untuk menjawab angka. Coba nama indikator dan wilayah persis seperti pada sumber.', sources: [] };
  if (rows.length > 1) return { status: 'clarify', answer: 'Ada lebih dari satu observasi atau sumber yang cocok. Perjelas indikator dan satuan, lalu periksa sumber berikut sebelum memilih nilai.', sources: rows.slice(0, 5).map(row => sourceCard({ ...row, id: `${row.documentId}:row${row.rowNumber}`, status: 'verified', year: row.year, region: row.region }, `${row.indicator}; ${row.year}; ${row.region}; ${row.valueRaw} ${row.unit}`)) };
  const row = rows[0];
  return { status: 'answered', answer: `${row.indicator} di ${row.region} pada tahun ${row.year}: ${formatExact(row.valueRaw)} ${row.unit}.${latest ? ' Ini adalah periode paling baru yang cocok dalam koleksi terverifikasi, bukan jaminan paling baru di seluruh portal.' : ''}`, sources: [sourceCard({ ...row, id: `${row.documentId}:row${row.rowNumber}`, status: 'verified' }, `Baris CSV ${row.rowNumber}: ${row.indicator}, ${row.year}, ${row.region}, ${row.valueRaw}, ${row.unit}`)] };
}

// Turns validated claims into the user-facing answer, citation indexes and
// excerpts for the hosted provider's structured claims.
function assembleGrounded(generated, result, store, scope) {
  const usedIds = new Set(generated.claims.flatMap(claim => claim.evidenceIds));
  const used = result.hits.filter(hit => usedIds.has(hit.id));
  if (used.some(hit => store.get(hit.documentId)?.status !== (scope === 'demo' ? 'demo' : 'verified'))) throw Object.assign(new Error('Sumber berubah selama permintaan.'), { code: 'invalid_evidence' });
  const documents = [...new Map(used.map(hit => [hit.documentId, hit])).values()];
  const sources = documents.map(hit => sourceCard(hit));
  const indexFor = id => sources.findIndex(source => source.documentId === used.find(hit => hit.id === id)?.documentId) + 1;
  const answer = generated.claims.map(claim => `${claim.text} ${[...new Set(claim.evidenceIds.map(indexFor))].map(index => `[${index}]`).join(' ')}`).join('\n\n');
  const excerpts = [...new Map(generated.claims.flatMap(claim => claim.quotes).map(quote => [quote.quote, { text: quote.quote, sourceIndex: indexFor(quote.evidenceId) }])).values()];
  return { answer, sources, excerpts, claims: generated.claims };
}

export async function answerQuestion(store, { question, scope = 'verified', useModel = false, previousQuestion = '',readPortalOnDemand=false,portalFetcher=fetch }, config) {
  const start = performance.now();
  const outside=isOutsidePortal(question);
  // Fill a short clarification; a new explicit question starts its own search.
  if (previousQuestion && question.length < 180 && /^(?:\d{4}\b|kalau\b|kalo\b|untuk\b|yang\b|tahun\b|di\b|kota\b|kecamatan\b|kelurahan\b|terbaru\b|bagaimana dengan\b)/i.test(question.trim())) {
    const nextYears = question.match(/\b(?:19|20)\d{2}\b/g) || [];
    const context = nextYears.length ? previousQuestion.replace(/\b(?:19|20)\d{2}\b/g, '') : previousQuestion;
    question = `${context} ${question}`;
  }
  const finish = result => ({ ...result, scope, resolvedQuestion:question.slice(0,2000),mode: result.mode || 'extractive', method: result.method || 'keyword', elapsedMs: Math.round(performance.now() - start) });
  if(outside)return finish(outsidePortalAnswer());
  if (/^(halo|hai|hello|selamat pagi|selamat siang|selamat sore|selamat malam|terima kasih|makasih)[!.,\s]*$/i.test(question)) return finish({status:'assistance',answer:'Halo! Saya bisa membantu mencari sumber publik dan menjelaskan metadata data Depok. Sebutkan topik, wilayah, dan tahun yang kamu butuhkan. Contoh: apa rumus persentase penanganan sampah?',sources:[]});
  if (/\bnik\b|nomor induk kependudukan|alamat pribadi|data pribadi/i.test(question)) return finish({ status: 'out_of_scope', answer: 'Prototipe ini membantu mencari data publik agregat. Saya tidak menyediakan NIK atau data pribadi warga. Kamu dapat mencari statistik kependudukan agregat yang tersedia.', sources: [] });
  if (/\b(?:abaikan|karang|mengarang)\b|buat saja angka|pura.pura|instruksi sebelumnya/i.test(question)) return finish({ status: 'insufficient_evidence', answer: 'Saya hanya dapat menyampaikan informasi dari sumber yang tersedia dalam koleksi. Saya tidak membuat angka atau sumber pengganti. Sebutkan topik data yang ingin dicari.', sources: [] });
  const discovery = /\b(cari|carikan|temukan|publikasi|tersedia|ketersediaan|ada data|dataset)\b/i.test(question) && !/definisi|jelaskan|metadata|cara/i.test(question);
  const definition = /definisi|jelaskan|arti|maksud|apa itu|rumus|ringkas|simpulkan|satuan|interpretasi|makna|metode|perbedaan|bedanya|cara (?:meng)?hitung/i.test(question);
  const numeric = !discovery && !definition && (/berapa|jumlahnya|nilai |total |banding|selisih|pertumbuhan|jumlahkan/i.test(question) || /(?:jumlah|persentase).*(?:\b(?:19|20)\d{2}\b|terbaru)/i.test(question));
  const candidates = candidateSearch(store, question);
  if(scope==='verified') {
    // Check scope before invoking embeddings or a model. A generic question
    // cannot become in-scope just because a vector happens to look similar.
    if(!hasPortalContext(question) && !hasTopicEvidence(question,candidates) && !hasTopicEvidence(question,store.portal.search(question,{limit:3})))return finish(outsidePortalAnswer());
    const navigation=portalNavigation(store,question,{numeric,definition});
    if(navigation)return finish({...navigation,coverage:coverageSummary(store)});
  }
  if (discovery && !tokens(question).length) return finish({ status: 'clarify', answer: 'Topik data apa yang ingin kamu cari? Sebutkan misalnya penduduk, kesehatan, sampah, atau publikasi tertentu, beserta wilayah jika ada.', sources: [] });
  if (numeric) {
    if (scope === 'demo') return finish({ status: 'insufficient_evidence', answer: 'Mode latihan berisi panduan aplikasi dan tidak berisi angka statistik Depok. Untuk membaca angka, beralih ke Koleksi publik lalu impor dan verifikasi tabel CSV sumber terlebih dahulu.', sources: candidates.map(row => sourceCard(row)), method: 'structured' });
    const result = numericAnswer(store, question);
    if (!result.sources.length) result.sources = candidates.map(row => sourceCard(row));
    if(result.status==='insufficient_evidence') {
      const suggestions=portalSuggestionsForNumber(store,question);
      if(suggestions){result.sources=suggestions.sources;result.notice=suggestions.notice;}
    }
    return finish({ ...result, method: 'structured' });
  }
  if (discovery) return finish({ status: candidates.length ? 'discovery' : 'insufficient_evidence', answer: candidates.length ? `Saya menemukan ${candidates.length} sumber terkait dalam katalog lokal. Periksa status setiap sumber: kandidat dan dokumen belum diperiksa belum dapat menjadi dasar jawaban faktual. Daftar ini belum mencakup seluruh portal.` : 'Belum ada sumber terkait dalam katalog lokal. Coba topik lain atau tambahkan dokumen publik melalui menu Koleksi sumber. Hasil kosong tidak berarti data tersebut tidak ada di portal.', sources: candidates.map(row => sourceCard(row)) });
  let embedQuery;
  if (useModel && embeddingsReady(config)) {
    embedQuery = async query => (await embedTexts([query], config))[0];
    embedQuery.model = embeddingIdentity(config);
  }
  const result = await retrieve(store, question, scope, embedQuery);
  let generationNotice='';
  if(useModel && config.provider==='openai' && result.hits.length) {
    if(modelReady(config)) {
      try {
        const generated=await generateGroundedAnswer(question,result.hits,config);
        store.logRun({provider:'openai',model:config.chatModel,status:'success',...generated.usage,elapsedMs:Math.round(performance.now()-start)});
        if(generated.status!=='answered')return finish({status:generated.status,answer:generated.status==='clarify'?'Sumber yang ditemukan belum cukup membedakan kebutuhanmu. Perjelas indikator, wilayah, atau periode yang dimaksud.':'Sumber yang ditemukan belum mendukung jawaban untuk pertanyaan ini. Saya tidak akan melengkapinya dengan perkiraan.',sources:[],mode:'generated',method:result.method,usage:generated.usage});
        const assembled=assembleGrounded(generated,result,store,scope);
        return finish({status:'answered',...assembled,method:result.method,mode:'generated',provider:'openai',model:config.chatModel,usage:generated.usage,notice:result.warning || undefined});
      } catch(error) {
        const failure=error.code==='invalid_evidence'?{code:'invalid_evidence',message:'Jawaban model tidak lolos pemeriksaan rujukan; yang ditampilkan adalah kutipan sumber.'}:providerError(error);
        generationNotice=failure.message;
        store.logRun({provider:'openai',model:config.chatModel,status:'failed',errorCode:failure.code,elapsedMs:Math.round(performance.now()-start)});
      }
    } else generationNotice='Layanan AI belum diaktifkan. Jawaban berikut memakai kutipan sumber yang tersedia.';
  }
  result.hits=result.hits.filter(hit=>store.get(hit.documentId)?.status===(scope==='demo'?'demo':'verified'));
  const sentences = rankSentences(result.hits, question);
  if(!sentences.length && scope==='verified') {
    const content=await portalContentAnswer(store,question,{useModel,config,readOnDemand:readPortalOnDemand,fetcher:portalFetcher});
    if(content)return finish({...content,coverage:coverageSummary(store)});
    if(!hasPortalContext(question) && !candidates.length)return finish(outsidePortalAnswer());
    if(store.portal.coverage().items)return finish({...portalNotFound(store,question),coverage:coverageSummary(store)});
  }
  if (!sentences.length) return finish({ status: 'insufficient_evidence', answer: scope === 'demo' ? 'Panduan latihan belum memuat jawaban untuk pertanyaan itu. Coba tanyakan cara mencari dataset, arti metadata, atau perbedaan tahun data dan tanggal pembaruan. Untuk topik Depok, gunakan Koleksi publik dan tambahkan sumber asli.' : 'Belum ada bukti yang sesuai dalam koleksi publik terverifikasi. Impor dokumen sumber dan tinjau isinya melalui menu Koleksi sumber. Kandidat katalog berikut hanya membantu menemukan sumber, belum membuktikan jawaban.', sources: candidates.filter(row=>store.get(row.documentId)?.status!=='withdrawn').map(row => sourceCard(row)), method: result.method, notice: [result.warning,generationNotice].filter(Boolean).join(' ') });
  let selected = sentences.slice(0, /rumus|hitung/i.test(question)?1:3), notice = [result.warning,generationNotice].filter(Boolean).join(' '), mode = 'extractive', modelUsage, compositionUsage, composedAnswer = '';
  if (useModel && config.provider!=='openai' && modelReady(config)) {
    const modelLabel=config.provider==='ollama' || !config.provider?'Model lokal':'Model';
    try {
      const selection = await selectEvidence(question, sentences.map(s => ({ id: s.id, text: s.text })), config);
      store.logRun({provider:config.provider || 'ollama',model:config.chatModel,status:'success',...selection.usage,elapsedMs:Math.round(performance.now()-start)});
      modelUsage = selection.usage;
      if (!selection.ids.length) return finish({ status: 'insufficient_evidence', answer: `${modelLabel} tidak menemukan kutipan yang cukup relevan untuk menjawab. Perjelas pertanyaan atau tambahkan sumber yang sesuai.`, sources: [], method: result.method, mode: 'model-assisted', usage: selection.usage });
      selected = selection.ids.map(id => sentences.find(s => s.id === id)); mode = 'model-assisted';
      // The evidence is already fixed, so the model only has to phrase it.
      // Failure keeps the extractive template: never show an unvalidated sentence.
      try {
        const composed = await composeLocalAnswer(question, selected.map(item => ({ id: item.id, text: item.text })), config);
        composedAnswer = composed.answer; compositionUsage = composed.usage; mode = 'generated';
        modelUsage = { inputTokens: (modelUsage?.inputTokens || 0) + composed.usage.inputTokens, outputTokens: (modelUsage?.outputTokens || 0) + composed.usage.outputTokens };
      } catch (composeError) {
        store.logRun({provider:config.provider,model:config.chatModel,status:'failed',errorCode:composeError.code || 'invalid_model_output',elapsedMs:Math.round(performance.now()-start)});
        notice = [notice, `${modelLabel} tidak dapat menyusun kalimat jawaban; kutipan sumber tetap ditampilkan.`].filter(Boolean).join(' ');
      }
    } catch (error) {
      const code = error instanceof SyntaxError || /tidak valid/.test(error.message) ? 'invalid_model_output' : providerError(error).code;
      store.logRun({provider:config.provider || 'ollama',model:config.chatModel,status:'failed',errorCode:code,elapsedMs:Math.round(performance.now()-start)});
      notice = [notice, `${modelLabel} tidak tersedia atau hasilnya tidak valid; kutipan dipilih dengan pencarian lokal.`].filter(Boolean).join(' ');
    }
  }
  const sourceMap = new Map();
  const activeSelected=selected.filter(item=>store.get(item.source.documentId)?.status===(scope==='demo'?'demo':'verified'));
  // A composed sentence may depend on any selected quote. Do not keep it if
  // even one source was withdrawn while the model was answering.
  if(!activeSelected.length || (composedAnswer && activeSelected.length!==selected.length))return finish({status:'insufficient_evidence',answer:'Status sumber berubah ketika jawaban sedang disiapkan. Silakan tanyakan kembali agar sumber aktif diperiksa ulang.',sources:[]});
  selected=activeSelected;
  if(composedAnswer)store.logRun({provider:config.provider,model:config.chatModel,status:'success',...compositionUsage,elapsedMs:Math.round(performance.now()-start)});
  const retired=selected.find(item=>/sudah tidak menjadi indikator/i.test(item.source.title));
  if(retired)notice=[notice,`Catatan keberlakuan dari judul sumber: ${retired.source.title}.`].filter(Boolean).join(' ');
  for (const item of selected) {
    if (!sourceMap.has(item.source.documentId)) sourceMap.set(item.source.documentId, sourceCard(item.source, item.text));
  }
  const sources = [...sourceMap.values()];
  const excerpts = selected.map(item => ({ text: item.text, sourceIndex: sources.findIndex(s => s.documentId === item.source.documentId) + 1 }));
  const answerText = composedAnswer
    ? `${composedAnswer} ${[...new Set(excerpts.map(item => item.sourceIndex))].map(index => `[${index}]`).join(' ')}`
    : (scope === 'demo' ? 'Berikut petunjuk dari panduan latihan aplikasi. Materi ini bukan dokumen resmi Pemerintah Kota Depok.' : 'Berikut kutipan yang cocok dari dokumen yang sudah ditinjau dalam koleksi lokal. Periksa konteks lengkap melalui kartu sumber.');
  return finish({ status: 'answered', answer: answerText, excerpts, sources, method: result.method, mode, usage: modelUsage, notice, ...(modelUsage ? { provider: config.provider || 'ollama', model: config.chatModel } : {}) });
}
