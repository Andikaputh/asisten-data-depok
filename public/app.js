const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const paths = {
  plus:'M12 5v14M5 12h14',chat:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
  layers:'m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',route:'M5 5h11a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h11M5 2v6M16 14l3 3-3 3',
  'arrow-up-right':'M7 17 17 7M7 7h10v10','arrow-up':'M12 19V5m-6 6 6-6 6 6','arrow-right':'M5 12h14m-6-6 6 6-6 6',
  lock:'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',sparkle:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4',
  search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',book:'M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V3Z',
  file:'M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 12h8M8 16h6',calendar:'M4 5h16v16H4V5ZM8 2v6m8-6v6M4 11h16',shield:'m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-6',
  info:'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',leaf:'M20 3C5 2 1 10 7 16s14 2 13-13ZM4 21 15 10',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',refresh:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2',cpu:'M6 6h12v12H6V6Zm4 4h4v4h-4v-4ZM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4',x:'m6 6 12 12M6 18 18 6',check:'m5 12 4 4L19 6',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); }); }
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
const statusNames = { verified:'Terverifikasi',unverified:'Belum diperiksa',candidate:'Kandidat',demo:'Latihan',withdrawn:'Nonaktif',catalogued:'Terdaftar di portal','portal-read':'HTML terbaca · belum ditinjau' };
const badge = status => `<span class="badge ${esc(status)}">${esc(statusNames[status] || status)}</span>`;
const date = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle:'medium', timeZone:'Asia/Jakarta' }).format(new Date(value)) : 'Belum diketahui';
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function loadLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function saveLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Penyimpanan browser penuh atau dibatasi; percakapan hanya disimpan untuk sesi ini.'); } }
let history = loadLocal('depok:history:v1', []);
if (!Array.isArray(history) || history.some(item => !item || !['user','assistant','error'].includes(item.role))) history = [];
history = history.slice(-60);
let scope = loadLocal('depok:scope:v1', 'demo');
if (!['demo','verified'].includes(scope)) scope = 'demo';
let useModel = loadLocal('depok:model:v1', false) === true;
let busy = false, sources = [], filter = 'all', status;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type':'application/json' } : {}), ...options.headers }, signal: AbortSignal.timeout(options.timeout || 115_000) });
  let body;
  try { body = await response.json(); } catch { throw new Error('Respons server tidak dapat dibaca.'); }
  if (!response.ok) throw new Error(body.error || 'Permintaan gagal.');
  return body;
}
const post = (path, body) => api(path, { method:'POST', body:JSON.stringify(body) });

function setView(view) {
  for (const name of ['chat','sources','pipeline','portal']) $(`#${name}-view`).hidden = name !== view;
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#page-title').textContent = { chat:'Asisten data', sources:'Koleksi sumber', pipeline:'Alur & model',portal:'Cakupan portal' }[view];
  if (view === 'sources') refreshSources().catch(error => toast(error.message));
  if (view === 'pipeline') refreshStatus().catch(error => toast(error.message));
  if (view === 'portal') refreshPortal().catch(error => toast(error.message));
}

function setScope(next) {
  if (busy) { toast('Tunggu jawaban selesai sebelum mengganti koleksi.'); return; }
  scope = next; saveLocal('depok:scope:v1', scope);
  $$('[data-scope]').forEach(button => button.classList.toggle('selected', button.dataset.scope === scope));
  $('#scope-note').innerHTML = `<span class="small-dot"></span>${scope === 'demo' ? 'Mode latihan · panduan aplikasi, bukan statistik resmi' : 'Koleksi publik · katalog dan halaman portal; angka memerlukan tabel yang ditinjau'}`;
}

function renderHistory() {
  $('#welcome').hidden = history.length > 0;
  $('#messages').innerHTML = history.length ? `<div class="chat-actions"><button class="text-button" data-action="new-chat">${icon('plus')}Percakapan baru</button><button class="text-button" data-action="export-chat">${icon('download')}Ekspor</button></div>` : '';
  for (const item of history) {
    const node = document.createElement('article');
    node.className = `message message-${item.role}`;
    if (item.role === 'user') node.innerHTML = `<div class="user-bubble">${esc(item.text)}</div>`;
    else if (item.role === 'error') node.innerHTML = `<p class="error-message">${esc(item.text)}</p>`;
    else {
      const response = item.response || {};
      node.innerHTML = `<div class="assistant-label"><img src="/favicon.svg" alt="">Asisten Data <span class="badge ${response.scope === 'demo' ? 'demo' : ''}">${response.scope === 'demo' ? 'Latihan' : 'Koleksi publik'}</span></div><p class="message-text">${esc(response.answer)}</p>${response.excerpts?.length ? `<ul class="excerpts">${response.excerpts.map(excerpt => `<li>${esc(excerpt.text)}<button class="cite-button" data-source-id="${esc(response.sources?.[excerpt.sourceIndex - 1]?.documentId || '')}" aria-label="Lihat sumber ${esc(excerpt.sourceIndex)}">${esc(excerpt.sourceIndex)}</button></li>`).join('')}</ul>` : ''}${response.sources?.length ? `<div class="answer-sources">${response.sources.map((source, index) => `<button class="answer-source" data-source-id="${esc(source.documentId)}">${badge(source.status)}<strong>${index + 1}. ${esc(source.title)}</strong><small>${esc(source.publisher)}${source.rowNumber ? ` · Baris ${esc(source.rowNumber)}` : ''}</small></button>`).join('')}</div>` : ''}<div class="answer-meta"><span>${response.method === 'structured' ? 'Pembacaan tabel' : response.method === 'hybrid' ? 'Pencarian hybrid' : 'Pencarian kata kunci'}</span><span>${response.mode === 'generated' ? (response.provider === 'ollama' ? 'Jawaban disusun model lokal' : 'Jawaban disusun model') : response.mode === 'model-assisted' ? 'Pemilihan bukti oleh model lokal' : 'Jawaban ekstraktif'}</span>${typeof response.elapsedMs === 'number' ? `<span>${(response.elapsedMs / 1000).toFixed(1)} detik</span>` : ''}</div>${response.notice ? `<p class="answer-notice">${esc(response.notice)}</p>` : ''}`;
    }
    $('#messages').append(node);
    if(item.role==='assistant') {
      const method=node.querySelector('.answer-meta span');
      const labels={'portal-catalogue':'Pencarian katalog portal','portal-content':'Pembacaan halaman portal','portal-navigation':'Panduan navigasi','portal-coverage':'Cakupan indeks','scope-guard':'Batas ruang lingkup'};
      if(method && labels[item.response?.method])method.textContent=labels[item.response.method];
      if(item.response?.mode==='model-assisted' && item.response.provider!=='ollama')node.querySelectorAll('.answer-meta span')[1].textContent='Bukti dipilih model';
    }
  }
  if (busy) {
    const pending = document.createElement('div'); pending.className = 'message';
    pending.innerHTML = '<div class="assistant-label">Mencari bukti dalam koleksi…</div><div class="typing" aria-label="Memproses"><span></span><span></span><span></span></div>';
    $('#messages').append(pending);
  }
}
function scrollChat() { $('#chat-scroll').scrollTop = history.length || busy ? $('#chat-scroll').scrollHeight : 0; }
async function sendQuestion(text) {
  if (busy) return;
  const question = text.trim(); if (!question) { $('#question').focus(); return; }
  if (question.length > 2000) { toast('Pertanyaan maksimal 2000 karakter.'); return; }
  const lastResponse = history.at(-1);
  const previousQuestion = lastResponse?.role === 'assistant' && lastResponse.response?.scope === scope && history.at(-2)?.role === 'user' ? lastResponse.response.resolvedQuestion || history.at(-2).text : '';
  history.push({ role:'user', text:question });
  busy = true; $('#send-button').disabled = true; $('#question').value = ''; $('#question').style.height = '';
  setView('chat'); renderHistory(); scrollChat();
  try {
    const response = await post('/api/chat', { question, scope, useModel, previousQuestion });
    history.push({ role:'assistant', response });
  } catch (error) { history.push({ role:'error', text:`${error.message} Pertanyaan belum terjawab; silakan coba lagi.` }); }
  finally { busy = false; $('#send-button').disabled = false; history = history.slice(-60); saveLocal('depok:history:v1', history); renderHistory(); scrollChat(); $('#question').focus(); }
}
function newChat() {
  if (busy) { toast('Tunggu jawaban selesai terlebih dahulu.'); return; }
  history = []; saveLocal('depok:history:v1', history); renderHistory(); setView('chat'); $('#question').focus();
}
function download(name, content, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportChat() {
  const body = history.map(item => item.role === 'user' ? `## Pengguna\n\n${item.text}` : item.role === 'assistant' ? `## Asisten (${item.response.scope})\n\n${item.response.answer}\n\n${(item.response.excerpts || []).map(e => `> ${e.text} [${e.sourceIndex}]`).join('\n\n')}\n\n${(item.response.sources || []).map((s,i) => `${i+1}. ${s.title} — ${s.status} — ${s.url || 'Panduan internal'} — versi ${s.version}`).join('\n')}` : `## Kesalahan\n\n${item.text}`).join('\n\n');
  download('percakapan-asisten-data-depok.md', `# Percakapan Asisten Data Depok\n\nPrototipe lokal; periksa sumber sebelum menggunakan informasi.\n\n${body}`);
}

async function refreshStatus() {
  status = await api('/api/status');
  const { counts, model } = status;
  $('#nav-count').textContent = Object.values(counts).reduce((sum, n) => sum + n, 0) - counts.withdrawn;
  $('#verified-count').textContent = counts.verified;
  $('#meter-fill').style.width = `${Math.min(100, counts.verified / 20 * 100)}%`;
  $('#stats-grid').innerHTML = [[counts.verified,'Publik terverifikasi'],[counts.unverified,'Menunggu pemeriksaan'],[counts.candidate,'Kandidat portal']].map(([n,label]) => `<div class="stat-card"><strong>${n}</strong><span>${label}</span></div>`).join('');
  const cloud=model.provider!=='ollama',providerName=model.provider==='openai'?'OpenAI':model.provider==='openai-compatible'?'API kompatibel OpenAI':'Ollama';
  $('#model-badge').textContent = cloud ? `${providerName} · ${model.keyConfigured?'kunci terisi':'kunci belum diisi'}` : model.online ? 'Ollama terhubung' : 'Ollama belum berjalan';
  $('#model-badge').className = `badge ${model.chatReady ? 'verified' : ''}`;
  $('#model-detail').innerHTML = `<div class="model-info-grid"><div class="model-info"><span>MODEL JAWABAN · ${cloud?'OPENAI API':'OLLAMA'}</span><strong>${esc(model.chatModel || 'Belum dikonfigurasi')}${model.chatModel ? (model.chatReady ? ' · dikonfigurasi' : ' · belum siap') : ''}</strong></div><div class="model-info"><span>MODEL EMBEDDING</span><strong>${esc(model.embeddingModel || 'Belum dikonfigurasi')}${model.embeddingModel ? (model.embeddingReady ? ' · dikonfigurasi' : ' · belum siap') : ''}</strong></div></div>`;
  $('#use-model').disabled = !model.chatReady && !model.embeddingReady;
  if ($('#use-model').disabled && useModel) { useModel = false; saveLocal('depok:model:v1', false); }
  $('#use-model').checked = useModel;
  $('#engine-label').textContent = useModel ? `LLM · ${providerName}` : 'Pencarian lokal · tanpa API';
  $('#model-detail').querySelector('.model-info span').textContent=`MODEL JAWABAN · ${providerName.toUpperCase()}`;
  $('#model-detail').querySelectorAll('.model-info span')[1].textContent=`MODEL EMBEDDING · ${(model.embeddingProvider || model.provider).toUpperCase()}`;
  $('#portal-nav-count').textContent=status.portal?.items || 0;
  $('#reindex-button').disabled = !model.embeddingReady || status.reindexing;
  $('#check-rag-button').disabled = !model.chatReady || !counts.verified || status.reindexing;
  $('#sync-sources-button').disabled = status.syncing;
  const index=status.rag?.index,last=status.rag?.recentRuns?.[0];
  $('#rag-diagnostics').textContent = `Sumber publik: ${counts.verified} · Observasi tabel: ${status.observations} · Embedding publik: ${index?.indexed || 0}/${index?.total || 0} potongan.${last ? ` Panggilan LLM terakhir: ${last.status==='success'?'berhasil':`gagal (${last.errorCode})`}.` : ' Belum ada panggilan LLM yang tercatat.'}`;
}

async function refreshSources() {
  const result = await api('/api/sources'); sources = result.sources; renderSources(); await refreshStatus();
}
function renderSources() {
  const query = $('#source-search').value.toLowerCase().trim();
  const visible = sources.filter(s => (filter === 'all' ? s.status !== 'withdrawn' : s.status === filter) && `${s.title} ${s.publisher} ${s.description}`.toLowerCase().includes(query));
  $('#source-list').innerHTML = visible.length ? visible.map(source => `<article class="source-row"><span class="source-file-icon">${icon(source.kind === 'catalog' ? 'layers' : 'file')}</span><div class="source-info"><h3>${esc(source.title)}</h3><p>${esc(source.publisher)}${source.kind === 'csv' ? ' · CSV' : ''}${source.year ? ` · ${esc(source.year)}` : ''}${source.region ? ` · ${esc(source.region)}` : ''}</p></div><div class="source-row-actions">${badge(source.status)}<button class="icon-button" data-source-id="${esc(source.id)}" aria-label="Buka ${esc(source.title)}">${icon('arrow-up-right')}</button></div></article>`).join('') : '<div class="empty-state">Belum ada sumber yang cocok.<br>Tambahkan dokumen atau ganti filter pencarian.</div>';
  $('#source-total').textContent = `${visible.length} sumber ditampilkan · tersimpan di perangkat ini`;
}

function openDialog(title, content) {
  $('#dialog-title').textContent = title; $('#dialog-content').innerHTML = content;
  if (!$('#source-dialog').open) $('#source-dialog').showModal();
}
function openImport() {
  openDialog('Tambah sumber publik', `<form id="import-form"><div class="collection-notice">${icon('info')}<p>Masukkan salinan sumber yang kamu peroleh secara sah. Impor tidak otomatis memverifikasi isi dokumen. TXT/MD dan CSV didukung; PDF perlu diekstrak dan diperiksa terlebih dahulu.</p></div><div class="form-grid"><label class="form-field">Judul sumber<input name="title" maxlength="200" required placeholder="Judul dokumen atau dataset"></label><label class="form-field">Penerbit / produsen<input name="publisher" maxlength="150" required placeholder="Nama instansi pada sumber"></label></div><label class="form-field">URL sumber asli<input name="sourceUrl" type="url" required placeholder="https://satudata.depok.go.id/…"><small>Tautan dicatat sebagai asal sumber. Aplikasi tidak mengunduh halaman secara otomatis.</small></label><div class="form-grid"><label class="form-field">Tahun observasi (opsional)<input name="year" pattern="(19|20)[0-9]{2}" maxlength="4" placeholder="Kosongkan jika belum diketahui"></label><label class="form-field">Cakupan wilayah (opsional)<input name="region" maxlength="150" placeholder="Sesuai sumber asli"></label></div><div class="upload-box"><p>Pilih TXT, Markdown, atau CSV · maksimal 500 KB</p><input id="file-input" type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"><p class="muted" id="file-note">CSV wajib: indicator,year,region,value,unit. Nilai memakai titik desimal tanpa pemisah ribuan.</p></div><label class="form-field">Jenis isi<select name="kind"><option value="text">Teks / Markdown</option><option value="csv">CSV observasi terstruktur</option></select></label><label class="form-field">Isi sumber<textarea name="content" required minlength="30" maxlength="500000" placeholder="Tempel teks asli yang sudah diperoleh, atau pilih berkas di atas…"></textarea><small>Pertahankan judul bagian, konteks, dan catatan sumber. Jangan masukkan data pribadi.</small></label><div id="form-error" class="form-error" hidden></div><div class="form-actions"><button type="button" class="text-button close-dialog">Batal</button><button type="submit" class="primary-button" id="save-source">${icon('plus')}Simpan untuk ditinjau</button></div></form>`);
  let filename = '';
  $('#file-input').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 500_000 || !/\.(txt|md|csv)$/i.test(file.name)) { toast('Pilih TXT, MD, atau CSV, maksimal 500 KB.'); event.target.value = ''; return; }
    try {
      const text = await file.text(); const form = $('#import-form');
      form.elements.content.value = text; form.elements.kind.value = /\.csv$/i.test(file.name) ? 'csv' : 'text';
      if (!form.elements.title.value) form.elements.title.value = file.name.replace(/\.[^.]+$/, '');
      filename = file.name; $('#file-note').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · periksa hasil sebelum menyimpan`;
    } catch { toast('Berkas tidak dapat dibaca.'); }
  });
  $('#import-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = $('#save-source');
    button.disabled = true; $('#form-error').hidden = true;
    try {
      const payload = Object.fromEntries(new FormData(form)); payload.filename = filename;
      const result = await post('/api/sources', payload);
      await refreshSources(); await openSource(result.source.id);
      toast(result.duplicate ? 'Salinan identik sudah ada dalam koleksi.' : 'Sumber disimpan. Periksa isi sebelum memverifikasi.');
    } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
    finally { button.disabled = false; }
  });
}

async function openSource(id) {
  try {
    const { source } = await api(`/api/sources/${encodeURIComponent(id)}`);
    const url = safeUrl(source.sourceUrl);
    openDialog(source.title, `${badge(source.status)}${source.status === 'candidate' ? '<p class="verification-warn">Ini kandidat dari indeks pencarian. Isi asli dan nilai tabel belum diverifikasi. Peroleh dokumen publik asli lalu impor sebagai sumber baru.</p>' : source.status === 'demo' ? '<p class="verification-warn">Materi latihan yang ditulis untuk prototipe ini. Bukan dokumen resmi atau statistik Pemerintah Kota Depok.</p>' : ''}<dl class="detail-meta"><div><dt>PENERBIT</dt><dd>${esc(source.publisher)}</dd></div><div><dt>WAKTU IMPOR · WIB</dt><dd>${date(source.retrievedAt)}</dd></div><div><dt>TAHUN OBSERVASI</dt><dd>${esc(source.year || 'Belum dicatat')}</dd></div><div><dt>CAKUPAN WILAYAH</dt><dd>${esc(source.region || 'Belum dicatat')}</dd></div>${source.reviewer ? `<div><dt>PENINJAU</dt><dd>${esc(source.reviewer)}</dd></div><div><dt>DITINJAU</dt><dd>${date(source.reviewedAt)}</dd></div>` : ''}</dl>${url ? `<a class="text-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right')}Buka sumber asli</a>` : ''}<p class="muted">${source.content ? 'Salinan teks tersimpan' : 'Catatan kandidat'} · versi ${esc(source.version)}${source.filename ? ` · ${esc(source.filename)}` : ''}</p><pre class="document-content">${esc(source.content || source.description)}</pre><p class="muted">SHA-256: ${esc(source.hash.slice(0, 20))}…</p>${source.status === 'unverified' ? `<form id="review-form" class="review-section"><h3>Tinjau sebelum dipakai sebagai bukti</h3><label class="checkbox-row"><input name="confirmed" type="checkbox" required><span>Saya sudah mencocokkan isi dengan sumber asli, memastikan materi bersifat publik, serta memeriksa indikator, tahun, wilayah, satuan, dan nilai bila ada. Ini peninjauan lokal, bukan pengesahan dari pemerintah.</span></label><label class="form-field">Nama peninjau<input name="reviewer" required minlength="3" maxlength="120" placeholder="Nama orang yang memeriksa"></label><div id="review-error" class="form-error" hidden></div><button class="primary-button" type="submit" id="verify-button">${icon('check')}Verifikasi sumber</button></form>` : ''}${['verified','unverified'].includes(source.status) ? `<div class="form-actions"><button id="withdraw-source" class="text-button danger-button">Nonaktifkan dari koleksi</button></div>` : ''}`);
    if ($('#review-form')) $('#review-form').addEventListener('submit', async event => {
      event.preventDefault(); $('#verify-button').disabled = true;
      try {
        await post(`/api/sources/${encodeURIComponent(id)}/verify`, { confirmed: event.currentTarget.elements.confirmed.checked, reviewer: event.currentTarget.elements.reviewer.value });
        await refreshSources(); await openSource(id); toast('Sumber terverifikasi dan siap untuk pencarian publik.');
      } catch (error) { if ($('#review-error')) { $('#review-error').textContent = error.message; $('#review-error').hidden = false; $('#verify-button').disabled = false; } else toast(error.message); }
    });
    if ($('#withdraw-source')) $('#withdraw-source').addEventListener('click', async () => {
      $('#withdraw-source').disabled = true;
      try { await post(`/api/sources/${encodeURIComponent(id)}/withdraw`, {}); await refreshSources(); await openSource(id); toast('Sumber dinonaktifkan. Riwayat lama tetap perlu diperiksa ulang.'); }
      catch (error) { toast(error.message); if ($('#withdraw-source')) $('#withdraw-source').disabled = false; }
    });
    if(['catalogued','portal-read'].includes(source.status)) {
      const note=document.createElement('p');note.className='verification-warn';
      note.textContent=`Inventaris portal · ${source.contentStatus==='read'?'halaman HTML sudah dibaca otomatis, belum ditinjau manual':'hanya katalog/tautan; isi berkas belum dibaca'}. ${source.format || 'HTML'}${source.periodLabel?` · periode yang tertulis di katalog: ${source.periodLabel}`:''}. Ini bukan bukti nilai observasi statistik.`;
      $('#dialog-content').prepend(note);
    }
  } catch (error) { toast(error.message); }
}

let portalOffset=0,portalTotal=0,portalTimer,portalSearchTimer;
async function refreshPortal() {
  clearTimeout(portalTimer);
  const query=$('#portal-query').value.trim(),section=$('#portal-section').value;
  const params=new URLSearchParams({limit:'20',offset:String(portalOffset)});
  if(section)params.set('section',section);if(query)params.set('q',query);
  const [coverage,result]=await Promise.all([api('/api/portal/status'),api(`/api/portal/${query?'search':'items'}?${params}`)]);
  portalTotal=result.total ?? result.items.length;
  const read=coverage.contentPages || 0;
  const stats=[[`${coverage.datasets} / ${coverage.reportedDatasets || '—'}`,'URL dataset / label jumlah portal'],[coverage.items,'Entri termasuk navigasi'],[read,'Panduan/detail/galeri HTML terbaca'],[coverage.unreadAttachments,'Lampiran belum diekstrak']];
  $('#portal-stats').innerHTML=stats.map(([value,label])=>`<div class="stat-card"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
  $('#portal-nav-count').textContent=coverage.items;
  const run=coverage.lastRun;
  $('#portal-progress').textContent=`${coverage.running?'Sedang berjalan. ':''}${run?`Batch terakhir: ${run.status}, ${run.processed} halaman, ${run.failed} gagal. ${run.note}`:'Belum ada sinkronisasi.'} Antrean: ${coverage.pending}; gagal/dibatasi: ${coverage.failed+coverage.blocked}; sebagian: ${coverage.partial}.`;
  $('#portal-policy').textContent=`Seluruh website belum dinyatakan selesai dipahami. Robots: ${coverage.robots}. Tautan eksternal: ${coverage.external}; halaman kosong: ${coverage.empty}; pagination dilewati: ${coverage.skipped}.`;
  $('#portal-sync-button').disabled=coverage.running;$('#portal-refresh-button').disabled=coverage.running;$('#portal-stop-button').disabled=!coverage.running;
  $('#portal-items').innerHTML=result.items.length?result.items.map(item=>`<article class="source-row"><span class="source-file-icon">${icon('file')}</span><div class="source-info"><h3>${esc(item.title)}</h3><p>${esc(item.publisher)} · ${esc(item.kind)} · ${esc(item.format)}${item.periodLabel?` · periode katalog ${esc(item.periodLabel)}`:''}</p></div><div class="source-row-actions">${badge(item.status)}<button class="icon-button" data-source-id="${esc(item.documentId)}" aria-label="Buka ${esc(item.title)}">${icon('arrow-up-right')}</button></div></article>`).join(''):'<p class="empty-state">Belum ada entri yang cocok. Hasil kosong bukan berarti sumber tidak ada di website.</p>';
  $('#portal-page-note').textContent=query?`${result.items.length} hasil paling relevan`:`${portalTotal?portalOffset+1:0}–${Math.min(portalOffset+20,portalTotal)} dari ${portalTotal} entri`;
  $('#portal-prev').disabled=Boolean(query) || portalOffset===0;$('#portal-next').disabled=Boolean(query) || portalOffset+20>=portalTotal;
  $('#portal-issues').innerHTML=coverage.issues.length?`<ul class="portal-issues">${coverage.issues.map(issue=>`<li><strong>${esc(issue.status)}</strong> — ${esc(issue.error)} ${safeUrl(issue.url)?`<a href="${esc(safeUrl(issue.url))}" target="_blank" rel="noopener noreferrer">Buka sumber</a>`:''}</li>`).join('')}</ul>`:'<p>Belum ada kegagalan yang tercatat. Ini bukan bukti seluruh sumber telah diproses.</p>';
  if(coverage.running && !$('#portal-view').hidden)portalTimer=setTimeout(()=>refreshPortal().catch(error=>toast(error.message)),3000);
}
async function startPortalSync(refresh=false) {
  try {await post('/api/portal/sync',{maxPages:40,includeDetails:$('#portal-details').checked,refresh});await refreshPortal();toast('Sinkronisasi berjalan bertahap; sumber yang gagal tetap tercatat.');}
  catch(error){toast(error.message);}
}
$('#portal-sync-button').addEventListener('click',()=>startPortalSync());
$('#portal-refresh-button').addEventListener('click',()=>startPortalSync(true));
$('#portal-stop-button').addEventListener('click',async()=>{try{await post('/api/portal/sync/cancel',{});await refreshPortal();}catch(error){toast(error.message);}});
$('#portal-query').addEventListener('input',()=>{clearTimeout(portalSearchTimer);portalOffset=0;portalSearchTimer=setTimeout(()=>refreshPortal().catch(error=>toast(error.message)),300);});
$('#portal-section').addEventListener('change',()=>{portalOffset=0;refreshPortal().catch(error=>toast(error.message));});
$('#portal-prev').addEventListener('click',()=>{portalOffset=Math.max(0,portalOffset-20);refreshPortal().catch(error=>toast(error.message));});
$('#portal-next').addEventListener('click',()=>{portalOffset+=20;refreshPortal().catch(error=>toast(error.message));});

document.addEventListener('click', event => {
  const view = event.target.closest('[data-view]'); if (view) setView(view.dataset.view);
  const scopeButton = event.target.closest('[data-scope]'); if (scopeButton) setScope(scopeButton.dataset.scope);
  const prompt = event.target.closest('[data-prompt]'); if (prompt) sendQuestion(prompt.dataset.prompt);
  const source = event.target.closest('[data-source-id]'); if (source?.dataset.sourceId) openSource(source.dataset.sourceId);
  if (event.target.closest('.close-dialog')) $('#source-dialog').close();
  const action = event.target.closest('[data-action]'); if (action?.dataset.action === 'new-chat') newChat(); if (action?.dataset.action === 'export-chat') exportChat();
  const filterButton = event.target.closest('[data-filter]'); if (filterButton) { filter = filterButton.dataset.filter; $$('[data-filter]').forEach(b => b.classList.toggle('selected', b.dataset.filter === filter)); renderSources(); }
});
$('#chat-form').addEventListener('submit', event => { event.preventDefault(); sendQuestion($('#question').value); });
$('#question').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendQuestion($('#question').value); } });
$('#question').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(130,event.target.scrollHeight)}px`; });
$('#new-chat').addEventListener('click', newChat);
$('#import-button').addEventListener('click', openImport);
$('#restore-file').addEventListener('change', async event => {
  const input = event.currentTarget, file = input.files[0]; input.value = '';
  if (!file) return;
  if (file.size > 64 * 1024 * 1024) { toast('Berkas cadangan maksimal 64 MB; gunakan pemulihan lewat CLI untuk berkas besar.'); return; }
  let backup;
  try { backup = JSON.parse(await file.text()); } catch { toast('Berkas bukan JSON yang valid.'); return; }
  const summary = backup.summary || {};
  const details = `${summary.documents ?? '?'} dokumen · ${summary.observations ?? '?'} observasi · ${summary.portalItems ?? '?'} entri portal · ${summary.portalPages ?? '?'} halaman`;
  const stamp = backup.exportedAt && !Number.isNaN(Date.parse(backup.exportedAt)) ? ` dari ${date(backup.exportedAt)}` : '';
  if (!confirm(`Pulihkan cadangan${stamp}?\n\n${details}\n\nData yang sudah ada tidak dihapus. Status verifikasi ikut dari berkas; pulihkan hanya cadangan milik sendiri.`)) return;
  try {
    const result = await post('/api/restore', { backup });
    await refreshSources();
    if (!$('#portal-view').hidden) await refreshPortal();
    const warnings = (result.warnings || []).map(item => `<li>${esc(item)}</li>`).join('');
    openDialog('Cadangan dipulihkan', `<div class="collection-notice">${icon('check')}<p><strong>${result.documents.added}</strong> dokumen ditambahkan, <strong>${result.documents.duplicate + result.documents.skipped}</strong> sudah ada atau dilewati. <strong>${result.portal.items}</strong> entri dan <strong>${result.portal.pages}</strong> halaman portal dipulihkan.</p></div>${warnings ? `<ul class="backup-warnings">${warnings}</ul>` : ''}<p class="muted">Bangun ulang indeks embedding bila ingin pencarian semantik pada dokumen yang dipulihkan.</p>`);
    toast('Cadangan dipulihkan. Periksa ringkasan sebelum memakai koleksi.');
  } catch (error) { toast(error.message); }
});
$('#source-search').addEventListener('input', renderSources);
$('#refresh-status').addEventListener('click', () => refreshStatus().then(() => toast('Status koneksi diperbarui.')).catch(error => toast(error.message)));
$('#use-model').addEventListener('change', event => { useModel = event.target.checked; saveLocal('depok:model:v1', useModel); $('#engine-label').textContent = useModel ? `LLM · ${status?.model?.provider==='openai'?'OpenAI API':status?.model?.provider==='openai-compatible'?'API kompatibel OpenAI':'Ollama'}` : 'Pencarian lokal · tanpa API'; });
$('#check-rag-button').addEventListener('click',async()=>{
  const button=$('#check-rag-button');button.disabled=true;$('#rag-diagnostics').textContent='Membangun indeks dan menguji pertanyaan dengan LLM asli…';
  try{const result=await post('/api/rag/check',{});$('#rag-diagnostics').textContent=result.ok?`Uji LLM berhasil: ${result.answer.mode}, ${result.answer.sources.length} sumber. ${result.answer.answer}`:`Uji belum berhasil. ${result.answer.notice || result.answer.answer}`;toast(result.ok?'RAG berhasil diuji dengan LLM asli.':'LLM belum menghasilkan jawaban terverifikasi.');}
  catch(error){$('#rag-diagnostics').textContent=error.message;toast(error.message);}
  finally{button.disabled=false;}
});
$('#sync-sources-button').addEventListener('click',async()=>{
  const button=$('#sync-sources-button');button.disabled=true;$('#rag-diagnostics').textContent='Mengambil halaman dan berkas publik terkurasi…';
  try{const result=await post('/api/public-sources/sync',{includeCsv:true});await refreshSources();toast(`${result.results.filter(item=>!item.error).length} sumber diperiksa. Tinjau sumber baru sebelum verifikasi.`);}
  catch(error){toast(error.message);}
  finally{button.disabled=false;}
});
$('#reindex-button').addEventListener('click', async () => {
  const button = $('#reindex-button'); button.disabled = true; button.innerHTML = `${icon('refresh')}Membangun indeks…`;
  try { const result = await post('/api/reindex', {}); toast(`${result.indexed} potongan teks berhasil diindeks.`); }
  catch (error) { toast(error.message); }
  finally { button.innerHTML = `${icon('refresh')}Bangun indeks embedding`; await refreshStatus().catch(() => {}); }
});
hydrateIcons(); setScope(scope); renderHistory(); scrollChat();
refreshSources().then(async () => {
  const params = new URLSearchParams(location.search);
  const question = params.get('question');
  const source = params.get('source');
    if (['sources','portal','pipeline'].includes(params.get('view'))) setView(params.get('view'));
  if (source && /^[a-zA-Z0-9-]+$/.test(source)) await openSource(source);
  if (question) { window.history.replaceState(null,'','/workspace'); await sendQuestion(question); }
}).catch(error => { toast(`Koneksi server gagal: ${error.message}`); $('#model-badge').textContent = 'Server tidak terhubung'; });
