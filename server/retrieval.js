const stopWords = new Set('apa apakah bagaimana cara saya aku kamu ingin mau tolong cari carikan temukan data dataset dokumen publikasi berapa jumlah total ada dan atau yang di ke dari pada untuk dengan itu ini sebuah tentang mengenai tahun wilayah jelaskan sebutkan berikan tampilkan nilai paling lebih baru terbaru terakhir dong ya nya info informasi kota kelurahan kecamatan berdasarkan bisa bisakah boleh bantu bantuin jelasin tahu pengen mengetahui perlu butuh berapakah gimana kalau kalo jika sedangkan tadi sebelumnya juga'.split(' '));
const aliases = { warga: 'penduduk', populasi: 'penduduk', penduduknya: 'penduduk', arti: 'definisi', artinya:'definisi',dimaksud:'definisi',maksudnya:'definisi',definisikan:'definisi',maknanya:'definisi',maksud: 'definisi', definisinya: 'definisi', diperbarui: 'pembaruan', update: 'pembaruan', diperbaharui: 'pembaruan', pemutakhiran: 'pembaruan' };
export function normalize(text) { return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
export function tokens(text) { return [...new Set(normalize(text).split(/\s+/).map(t => aliases[t] || t).filter(t => t.length > 1 && !stopWords.has(t) && !/^\d+$/.test(t)))]; }

export function cosine(a, b) {
  if (a.length !== b.length) return 0;
  const normA = Math.hypot(...a), normB = Math.hypot(...b);
  return normA && normB ? a.reduce((sum, n, i) => sum + n * b[i], 0) / (normA * normB) : 0;
}

export function lexicalSearch(store, question, statuses, limit = 12) {
  const terms = tokens(question).slice(0, 24);
  if (!terms.length) return [];
  const query = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ');
  const rows = store.db.prepare(`SELECT c.*,d.title,d.kind,d.sourceUrl,d.publisher,d.status,d.year,d.region,d.retrievedAt,d.reviewedAt,d.version,bm25(chunks_fts,0,0,3,1) AS score
    FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.id JOIN documents d ON d.id=c.documentId
    WHERE chunks_fts MATCH ? AND d.status IN (${statuses.map(() => '?').join(',')}) ORDER BY score LIMIT ?`).all(query, ...statuses, limit);
  return rows;
}

export function candidateSearch(store, question) {
  const seen = new Set();
  return lexicalSearch(store, question, ['candidate','unverified','verified'], 20).sort((a,b)=>(a.status==='verified'?0:1)-(b.status==='verified'?0:1) || a.score-b.score).filter(row => {
    const key=row.sourceUrl || row.documentId;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 4);
}

export async function retrieve(store, question, scope, embedQuery) {
  const status = scope === 'demo' ? 'demo' : 'verified';
  let lexical = lexicalSearch(store, question, [status]);
  const years = question.match(/\b(?:19|20)\d{2}\b/g) || [];
  const fits = row => row.kind !== 'csv' && (scope === 'demo' || !years.length || (row.year && years.includes(row.year)));
  lexical = lexical.filter(fits);
  // Generic words such as 'rumus' must not retrieve formulas for unrelated indicators.
  const generic=new Set(['rumus','hitung','menghitung','perhitungan','persentase','definisi','satuan','konsep','indikator','metadata','pengertian','jelaskan','makna','interpretasi','perbedaan']);
  const topics=tokens(question).filter(term=>!generic.has(term));
  const generalMetadata=!topics.length && tokens(question).includes('metadata');
  if(generalMetadata)lexical=lexical.filter(row=>normalize(row.title).includes('metadata'));
  const topicHits=row=>topics.filter(term=>tokens(`${row.title} ${row.publisher} ${row.text}`).includes(term)).length;
  if(topics.length)lexical=lexical.filter(row=>topicHits(row)>=Math.min(2,topics.length));
  let semantic = [], warning = '';
  const semanticCandidates=embedQuery?store.activeChunks(scope).filter(row=>row.vector && row.embeddingModel===embedQuery.model && fits(row) && (!generalMetadata || normalize(row.title).includes('metadata')) && (!topics.length || topicHits(row)>=Math.min(2,topics.length))):[];
  if (embedQuery && semanticCandidates.length) {
    try {
      const queryVector = await embedQuery(question);
      semantic = semanticCandidates
        .map(row => ({ ...row, similarity: cosine(JSON.parse(row.vector), queryVector) }))
        .filter(row => row.similarity >= 0.45).sort((a,b) => b.similarity - a.similarity).slice(0, 12);
    } catch { warning = 'Embedding tidak tersedia; pencarian kata kunci tetap digunakan.'; }
  } else if(embedQuery) warning='Indeks embedding belum tersedia untuk koleksi ini; pencarian kata kunci digunakan.';
  const ranks = new Map();
  for (const list of [lexical, semantic]) list.forEach((row, rank) => {
    const previous = ranks.get(row.id);
    ranks.set(row.id, { ...row, fusion: (previous?.fusion || 0) + 1 / (60 + rank + 1) });
  });
  return { hits: [...ranks.values()].sort((a,b) => b.fusion - a.fusion).slice(0, 5), method: semantic.length ? 'hybrid' : 'keyword', warning };
}

export function rankSentences(hits, question) {
  const terms = tokens(question);
  const sentences = hits.flatMap(hit => {
    const parts=hit.text.split(/\n+/).filter(Boolean).flatMap(line=>line.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý"“])/));
    return parts.map((text, i) => {
      let score=tokens(text).filter(t=>terms.includes(t)).length;
      if(/rumus|hitung/i.test(question) && /^Metode\s*\/\s*Rumus/i.test(text))score+=8;
      if(/satuan/i.test(question) && /^Satuan(?::|\s)/i.test(text))score+=6;
      if(/definisi|apa itu|pengertian|arti/i.test(question) && (/^Definisi(?::|\s)/i.test(text) || /^Metadata adalah/i.test(text)))score+=5;
      if(/interpretasi|makna/i.test(question) && /^Interpretasi(?::|\s)/i.test(text))score+=6;
      if(/kapan|tanggal|pembaruan|diperbarui/i.test(question) && /^Dataset Diperbarui(?::|\s)/i.test(text))score+=6;
      return {id:`${hit.id}/s${i}`,evidenceId:hit.id,text:text.trim(),source:hit,score};
    });
  }).filter(s => (s.text.length>20 || s.text.length>8 && /^(Satuan|Ukuran|Level Estimasi|Konsep)(?::|\s)/i.test(s.text)) && s.score > 0 && normalize(s.text)!==normalize(s.source.title) && !/^Dataset:/i.test(s.text));
  const seen = new Set();
  return sentences.sort((a,b) => b.score - a.score).filter(s => { if (seen.has(s.text)) return false; seen.add(s.text); return true; }).slice(0, 12);
}
