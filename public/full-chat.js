const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const paths = {
  plus:'M12 5v14M5 12h14',edit:'M12 20h9M16 3l5 5-11 11-6 1 1-6L16 3Z',
  chat:'M21 11a8 8 0 0 1-8 8H8l-5 3V6a4 4 0 0 1 4-4h6a8 8 0 0 1 8 9Z',
  'arrow-up-right':'M7 17 17 7M7 7h10v10','arrow-up':'M12 19V5m-6 6 6-6 6 6','arrow-right':'M5 12h14m-5-5 5 5-5 5','arrow-left':'M19 12H5m5-5-5 5 5 5',
  search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  bot:'M7 6h10a4 4 0 0 1 4 4v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a4 4 0 0 1 4-4ZM12 6V3m-2 0h4M8 12v2m8-2v2m-7 3h6M3 11H1m22 0h-2',
  sparkle:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4',
  layers:'m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  book:'M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V3Z',
  file:'M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 12h8M8 16h6','file-search':'M14 2H5v20h7M14 2v6h5V7l-5-5Zm7 20-3-3m1-3a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  calendar:'M4 5h16v16H4V5ZM8 2v6m8-6v6M4 11h16',shield:'m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-6',
  user:'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',lock:'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',
  info:'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',x:'m6 6 12 12M6 18 18 6','panel-left':'M3 3h18v18H3V3Zm6 0v18',copy:'M8 8h13v13H8V8ZM4 16H2V2h14v2',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch { toast('Penyimpanan browser dibatasi; riwayat hanya tersedia selama sesi ini.'); } }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; },4200); }
function validHistory(value) { return Array.isArray(value) && value.every(item => item && ['user','assistant','error'].includes(item.role) && (item.role !== 'assistant' || (item.response && typeof item.response.answer === 'string'))) ? value.slice(-60) : []; }
let history = validHistory(load('depok:history:v1',[]));
let sessions = load('depok:conversations:v1',[]);
if (!Array.isArray(sessions)) sessions = [];
sessions = sessions.filter(session => session && typeof session.id === 'string' && typeof session.title === 'string' && Array.isArray(session.messages)).slice(0,15);
let activeId = load('depok:active-conversation:v1','');
if (typeof activeId !== 'string' || !activeId) activeId = crypto.randomUUID();
let scope = load('depok:scope:v1','demo') === 'verified' ? 'verified' : 'demo';
let busy = false, references = [], activeDrawer = '', drawerTrigger;
const wideScreen = matchMedia('(min-width:1251px)'), mobileScreen = matchMedia('(max-width:760px)');
const statusNames = {demo:'Panduan latihan',verified:'Terverifikasi',candidate:'Kandidat sumber',unverified:'Belum diperiksa',withdrawn:'Nonaktif',catalogued:'Terdaftar di portal','portal-read':'HTML terbaca · belum ditinjau'};
const badge = status => `<span class="source-badge ${esc(status)}">${esc(statusNames[status] || status)}</span>`;
const sourceArray = response => Array.isArray(response.sources) ? response.sources : [];
const excerptArray = response => Array.isArray(response.excerpts) ? response.excerpts : [];
const coverageNote=document.createElement('div');coverageNote.className='portal-coverage-note';coverageNote.id='portal-coverage';coverageNote.hidden=true;$('.conversation-toolbar').after(coverageNote);

function archiveCurrent() {
  const first = history.find(item => item.role === 'user');
  if (!first) return;
  const session = {id:activeId,title:String(first.text || 'Percakapan').slice(0,85),messages:history,updatedAt:new Date().toISOString()};
  sessions = [session,...sessions.filter(item => item.id !== activeId)].slice(0,15);
  save('depok:conversations:v1',sessions);
}
function persist() { save('depok:history:v1',history); save('depok:active-conversation:v1',activeId); archiveCurrent(); }
function renderSidebar() {
  const term = $('#history-search').value.trim().toLowerCase();
  let list = sessions.filter(session => session.id !== activeId);
  const first = history.find(item => item.role === 'user');
  if (first) list = [{id:activeId,title:String(first.text || 'Percakapan'),messages:history},...list];
  list = list.filter(session => session.title.toLowerCase().includes(term));
  $('#history-count').textContent = list.length;
  $('#history-list').innerHTML = list.length ? list.map(session => `<button class="conversation-item ${session.id === activeId ? 'active' : ''}" data-session="${esc(session.id)}" title="${esc(session.title)}">${icon('chat')}<span>${esc(session.title)}</span>${session.id === activeId ? '<span class="current-dot"></span>' : ''}</button>`).join('') : `<p class="history-empty">${term ? 'Belum ada percakapan yang cocok.' : 'Belum ada percakapan.<br>Mulai dengan satu pertanyaan.'}</p>`;
}
function setScope(next) {
  if (busy) { $('#scope-select').value = scope; toast('Tunggu jawaban selesai sebelum mengganti koleksi.'); return; }
  scope = next === 'verified' ? 'verified' : 'demo'; save('depok:scope:v1',scope); $('#scope-select').value = scope;
  $('#scope-note').innerHTML = `<span></span>${scope === 'demo' ? 'Mode simulasi · jawaban dari koleksi percobaan' : 'Koleksi publik · cari sumber portal; angka dibaca dari tabel yang ditinjau'}`;
}
function latestReferences() { return sourceArray([...history].reverse().find(item => item.role === 'assistant')?.response || {}); }
function renderReferences(next = latestReferences()) {
  references = next;
  $('#reference-content').innerHTML = references.length ? `<p class="reference-count">${references.length} rujukan pada jawaban yang dipilih. Buka detail untuk memeriksa isi dan statusnya.</p>${references.map((source,index) => `<button class="reference-source" data-source-id="${esc(source.documentId)}">${badge(source.status)}<strong>${index + 1}. ${esc(source.title)}</strong><p>${esc(source.publisher)}${source.year ? ` · ${esc(source.year)}` : ''}</p><span>Lihat detail sumber ${icon('arrow-up-right')}</span></button>`).join('')}` : `<div class="reference-empty"><span class="reference-empty-icon">${icon('file-search')}</span><strong>Kenali sumber di balik jawaban.</strong><p>Rujukan yang ditemukan akan muncul di sini, supaya kamu bisa memeriksa konteksnya.</p></div>`;
}
function renderMessages() {
  $('#welcome').hidden = history.length > 0;
  $('#messages').innerHTML = history.map((item,index) => {
    if (item.role === 'user') return `<article class="message message-user"><div class="user-bubble">${esc(item.text)}</div><span class="mini-avatar">${icon('user')}</span></article>`;
    if (item.role === 'error') return `<article class="message message-error">${esc(item.text)}</article>`;
    const response = item.response;
    return `<article class="message message-assistant"><div class="assistant-label"><span class="mini-avatar">${icon('bot')}</span>Asisten Data Depok<span>${response.scope === 'demo' ? 'Mode simulasi' : 'Koleksi publik'}</span></div><div class="assistant-answer"><p class="message-text">${esc(response.answer)}</p>${excerptArray(response).length ? `<ul class="excerpts">${excerptArray(response).map(excerpt => `<li>${esc(excerpt.text)}<button class="cite-button" data-source-id="${esc(sourceArray(response)[excerpt.sourceIndex - 1]?.documentId || '')}" aria-label="Lihat rujukan ${esc(excerpt.sourceIndex)}">${esc(excerpt.sourceIndex)}</button></li>`).join('')}</ul>` : ''}${sourceArray(response).length ? `<div class="answer-sources">${sourceArray(response).map((source,i) => `<button class="answer-source" data-source-id="${esc(source.documentId)}">${badge(source.status)}<strong>${i + 1}. ${esc(source.title)}</strong><small>${esc(source.publisher)}${source.rowNumber ? ` · Baris ${esc(source.rowNumber)}` : ''}</small></button>`).join('')}</div>` : ''}${response.notice ? `<p class="answer-notice">${esc(response.notice)}</p>` : ''}<div class="answer-actions"><button data-copy="${index}" aria-label="Salin jawaban">${icon('copy')}Salin</button><button data-export="${index}" aria-label="Unduh percakapan">${icon('download')}Unduh</button>${sourceArray(response).length ? `<button data-references="${index}">${icon('layers')}${sourceArray(response).length} sumber</button>` : ''}${typeof response.elapsedMs === 'number' ? `<span class="elapsed-time">${(response.elapsedMs/1000).toFixed(1)} detik</span>` : ''}</div></div></article>`;
  }).join('') + (busy ? `<article class="message"><div class="assistant-label"><span class="mini-avatar">${icon('bot')}</span>Asisten Data Depok</div><div class="assistant-answer pending-answer"><span class="pending-dots"><span></span><span></span><span></span></span>Menyiapkan jawaban dari koleksi…</div></article>` : '');
  renderSidebar();
}
function scrollChat() { const scroll = $('#chat-scroll'); scroll.scrollTop = history.length || busy ? scroll.scrollHeight : 0; }
function render() { renderMessages(); renderReferences(); scrollChat(); }
async function ask(text) {
  if (busy) return;
  const question = text.trim(); if (!question) { $('#question').focus(); return; }
  if (question.length > 2000) { toast('Pertanyaan maksimal 2000 karakter.'); return; }
  const previous = history.at(-1);
  const previousQuestion = previous?.role === 'assistant' && previous.response.scope === scope && history.at(-2)?.role === 'user' ? previous.response.resolvedQuestion || history.at(-2).text : '';
  history.push({role:'user',text:question}); busy = true; $('#send-button').disabled = true; $('#scope-select').disabled = true; $('#question').value = ''; resizeComposer();
  render(); closeDrawer();
  try {
    const res = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,scope,previousQuestion,useModel:true}),signal:AbortSignal.timeout(115000)});
    const response = await res.json(); if (!res.ok) throw new Error(response.error || 'Permintaan belum berhasil.');
    history.push({role:'assistant',response});
  } catch (error) { history.push({role:'error',text:`${error.message} Pertanyaan belum terjawab. Silakan coba lagi.`}); }
  finally { history = history.slice(-60); busy = false; $('#send-button').disabled = false; $('#scope-select').disabled = false; persist(); render(); $('#question').focus(); }
}
function newConversation() {
  if (busy) { toast('Tunggu jawaban selesai terlebih dahulu.'); return; }
  archiveCurrent(); history = []; activeId = crypto.randomUUID(); persist(); render(); closeDrawer(); $('#question').value = ''; resizeComposer(); $('#question').focus();
}
function selectConversation(id) {
  if (busy) { toast('Tunggu jawaban selesai terlebih dahulu.'); return; }
  if (id === activeId) { closeDrawer(); return; }
  const session = sessions.find(item => item.id === id); if (!session) return;
  archiveCurrent(); activeId = session.id; history = validHistory(session.messages); persist(); render(); closeDrawer();
}
function resizeComposer() { const textarea = $('#question'); textarea.style.height = 'auto'; textarea.style.height = `${Math.min(150,textarea.scrollHeight)}px`; $('#character-count').textContent = `${textarea.value.length} / 2000`; }
function compose(text) { closeDrawer(); $('#question').value = text; resizeComposer(); $('#question').focus(); }

function closeDrawer() {
  document.body.classList.remove('sidebar-open','sources-open'); $('#drawer-backdrop').hidden = true; activeDrawer = ''; $('#open-sidebar').setAttribute('aria-expanded','false');
  $('#toggle-sources').setAttribute('aria-expanded',String(wideScreen.matches && !document.body.classList.contains('sources-collapsed')));
}
function openDrawer(kind, trigger) {
  if (kind === 'sources' && wideScreen.matches) { document.body.classList.remove('sources-collapsed'); $('#toggle-sources').setAttribute('aria-expanded','true'); return; }
  closeDrawer(); activeDrawer = kind; drawerTrigger = trigger; document.body.classList.add(kind === 'sidebar' ? 'sidebar-open' : 'sources-open'); $('#drawer-backdrop').hidden = false;
  (kind === 'sidebar' ? $('#open-sidebar') : $('#toggle-sources')).setAttribute('aria-expanded','true');
  (kind === 'sidebar' ? $('#close-sidebar') : $('#close-sources')).focus();
}
function dismissDrawer() { closeDrawer(); if (drawerTrigger?.isConnected) drawerTrigger.focus(); }
function closeSources() {
  if (wideScreen.matches) { document.body.classList.add('sources-collapsed'); $('#toggle-sources').setAttribute('aria-expanded','false'); $('#toggle-sources').focus(); }
  else dismissDrawer();
}
async function openSource(id) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return;
  try {
    const res = await fetch(`/api/sources/${encodeURIComponent(id)}`,{signal:AbortSignal.timeout(10000)}); const body = await res.json(); if (!res.ok) throw new Error(body.error || 'Rujukan tidak dapat dibuka.');
    const source = body.source;
    const date = value => value ? new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeZone:'Asia/Jakarta'}).format(new Date(value)) : 'Belum dicatat';
    let url = ''; try { const parsed = new URL(source.sourceUrl); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) url = parsed.href; } catch {}
    $('#dialog-title').textContent = source.title;
    $('#dialog-content').innerHTML = `${badge(source.status)}<p class="source-explanation">${source.status === 'demo' ? 'Ini panduan latihan aplikasi. Materi ini bukan dokumen resmi atau angka statistik Pemerintah Kota Depok.' : source.status === 'candidate' ? 'Halaman ini masih berupa kandidat. Isi sumber asli belum diverifikasi untuk menjadi dasar jawaban faktual.' : source.status === 'withdrawn' ? 'Sumber ini sudah dinonaktifkan. Jawaban lama yang merujuknya perlu diperiksa kembali.' : 'Periksa isi, periode, dan cakupan sumber sebelum menggunakan informasi ini.'}</p><dl class="source-detail-meta"><div><dt>PENERBIT</dt><dd>${esc(source.publisher)}</dd></div><div><dt>DITAMBAHKAN KE KOLEKSI</dt><dd>${date(source.retrievedAt)}</dd></div><div><dt>TAHUN OBSERVASI</dt><dd>${esc(source.year || 'Belum dicatat')}</dd></div><div><dt>CAKUPAN WILAYAH</dt><dd>${esc(source.region || 'Belum dicatat')}</dd></div></dl><pre class="document-content">${esc(source.content || source.description)}</pre>${url ? `<a class="source-origin" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Buka halaman sumber asli ${icon('arrow-up-right')}</a>` : ''}<p class="source-version">Salinan versi ${esc(source.version)} · detail ditampilkan dari koleksi lokal.</p>`;
    if(['catalogued','portal-read'].includes(source.status)) {
      $('#dialog-content .source-explanation').textContent=source.contentStatus==='read'?'Halaman HTML dibaca otomatis dari portal; belum ditinjau manual. Periksa konteks lengkap dan tanggal sumber.':'Sumber ini tercatat dalam katalog portal. Isi berkas belum dibaca otomatis; judulnya bukan bukti nilai statistik.';
      const note=document.createElement('p');note.className='source-version';note.textContent=`Format: ${source.format || 'HTML'}${source.periodLabel?` · periode yang tertulis di katalog: ${source.periodLabel}`:''}.`;
      $('#dialog-content').prepend(note);
    }
    if (!$('#source-dialog').open) $('#source-dialog').showModal();
  } catch (error) { toast(error.message); }
}
function answerText(response) { return [response.answer,...excerptArray(response).map(e => `${e.text} [${e.sourceIndex}]`),...sourceArray(response).map((s,i) => `${i+1}. ${s.title} — ${s.url || 'Panduan latihan lokal'} (${statusNames[s.status] || s.status})`)].join('\n\n'); }
async function copyAnswer(index) { try { await navigator.clipboard.writeText(answerText(history[index].response)); toast('Jawaban beserta rujukannya disalin.'); } catch { toast('Browser belum mengizinkan penyalinan. Kamu tetap bisa mengunduh percakapan.'); } }
function exportConversation() {
  const content = '# Percakapan Asisten Data Depok\n\nPrototipe magang — periksa sumber sebelum menggunakan jawaban.\n\n' + history.map(item => item.role === 'user' ? `## Pengguna\n\n${item.text}` : item.role === 'assistant' ? `## Asisten\n\n${answerText(item.response)}` : `## Keterangan\n\n${item.text}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'})); const link = document.createElement('a'); link.href = url; link.download = 'percakapan-asisten-data-depok.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}

$('#chat-form').addEventListener('submit',event => { event.preventDefault(); ask($('#question').value); });
$('#question').addEventListener('input',resizeComposer);
$('#question').addEventListener('keydown',event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask($('#question').value); } });
$('#scope-select').addEventListener('change',event => setScope(event.target.value));
$('#new-chat').addEventListener('click',newConversation);
$('#history-search').addEventListener('input',renderSidebar);
$('#open-sidebar').addEventListener('click',event => openDrawer('sidebar',event.currentTarget));
$('#close-sidebar').addEventListener('click',dismissDrawer);
$('#toggle-sources').addEventListener('click',event => {
  if (wideScreen.matches && !document.body.classList.contains('sources-collapsed')) closeSources();
  else if (activeDrawer === 'sources') dismissDrawer(); else openDrawer('sources',event.currentTarget);
});
$('#close-sources').addEventListener('click',closeSources);
$('#drawer-backdrop').addEventListener('click',dismissDrawer);
$('#close-source-dialog').addEventListener('click',() => $('#source-dialog').close());
document.addEventListener('click',event => {
  const prompt = event.target.closest('[data-prompt]'); if (prompt) ask(prompt.dataset.prompt);
  const composition = event.target.closest('[data-compose]'); if (composition) compose(composition.dataset.compose);
  const session = event.target.closest('[data-session]'); if (session) selectConversation(session.dataset.session);
  const source = event.target.closest('[data-source-id]'); if (source) openSource(source.dataset.sourceId);
  const reference = event.target.closest('[data-references]'); if (reference) { renderReferences(sourceArray(history[Number(reference.dataset.references)]?.response || {})); openDrawer('sources',reference); }
  const copy = event.target.closest('[data-copy]'); if (copy) copyAnswer(Number(copy.dataset.copy));
  if (event.target.closest('[data-export]')) exportConversation();
});
document.addEventListener('keydown',event => {
  if ($('#source-dialog').open) return;
  if (event.key === 'Escape' && activeDrawer) { dismissDrawer(); return; }
  if (event.key === 'Tab' && activeDrawer) {
    const panel = activeDrawer === 'sidebar' ? $('#conversation-sidebar') : $('#reference-panel');
    const focusable = [...panel.querySelectorAll('button,a,input,select')].filter(el => el.getClientRects().length && !el.disabled);
    if (!focusable.length) return;
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  }
});
wideScreen.addEventListener('change',() => { closeDrawer(); $('#toggle-sources').setAttribute('aria-expanded',String(wideScreen.matches && !document.body.classList.contains('sources-collapsed'))); });
mobileScreen.addEventListener('change',closeDrawer);
window.addEventListener('storage',event => { if (busy || !event.key?.startsWith('depok:')) return; history = validHistory(load('depok:history:v1',[])); const archived = load('depok:conversations:v1',[]); if (Array.isArray(archived)) sessions = archived.filter(s => s && typeof s.id === 'string' && typeof s.title === 'string' && Array.isArray(s.messages)); setScope(load('depok:scope:v1','demo')); render(); });
setScope(scope); render(); closeDrawer();
const params = new URLSearchParams(location.search);
if (params.get('view') === 'sources') location.replace('/workspace?view=sources');
else {
  const source = params.get('source'), question = params.get('question');
  // Consume navigation actions once so reload restores the conversation, not an old popup.
  if (source || question) window.history.replaceState(null,'','/chat');
  if (source) openSource(source);
}
fetch('/api/status',{signal:AbortSignal.timeout(5000)}).then(response=>response.json()).then(runtime=>{
   if((runtime.counts?.verified>0 || runtime.portal?.items>0) && !load('depok:public-default:v1',false) && !busy){setScope('verified');save('depok:public-default:v1',true);}
   if(runtime.portal?.items>0){coverageNote.hidden=false;coverageNote.textContent=`Indeks: ${runtime.portal.datasets} URL dataset · ${runtime.portal.items} entri termasuk navigasi. Seluruh isi website belum dinyatakan terbaca.`;$('.reference-note p').textContent='Asisten khusus Portal Satu Data Depok. Entri katalog, halaman yang terbaca, dan tabel yang ditinjau memiliki tingkat bukti berbeda.';}
  if(!busy)$('#assistant-mode').textContent=runtime.model?.chatReady?'Layanan AI dikonfigurasi · jawaban bersumber':'Mode kutipan · layanan AI belum aktif';
}).catch(()=>{}).finally(()=>{if(params.get('question') && params.get('view')!=='sources')ask(params.get('question'));});
