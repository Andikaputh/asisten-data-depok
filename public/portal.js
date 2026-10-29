const $ = selector => document.querySelector(selector);
const paths = {
  external:'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
  'arrow-right':'M5 12h14m-5-5 5 5-5 5','arrow-up-right':'M7 17 17 7M7 7h10v10',
  chevron:'m7 10 5 5 5-5',menu:'M4 6h16M4 12h16M4 18h16',x:'m6 6 12 12M6 18 18 6',
  chat:'M21 11a8 8 0 0 1-8 8H8l-5 3V6a4 4 0 0 1 4-4h6a8 8 0 0 1 8 9Z',
  search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  sparkle:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4',
  shield:'m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-6',
  database:'M20 5c0 2-4 3-8 3S4 7 4 5s4-3 8-3 8 1 8 3Zm0 0v14c0 2-4 3-8 3s-8-1-8-3V5m0 7c0 2 4 3 8 3s8-1 8-3',
  chart:'M4 3v18h17M8 16v-5m5 5V7m5 9V4',pie:'M11 3a9 9 0 1 0 10 10H11V3Zm4 0v6h6a9 9 0 0 0-6-6Z',
  building:'M4 22V6h10v16M14 11h6v11M8 10h2m-2 4h2m-2 4h2M2 22h20',
  file:'M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 12h8M8 16h6',calendar:'M4 5h16v16H4V5ZM8 2v6m8-6v6M4 11h16',
  info:'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  bot:'M7 6h10a4 4 0 0 1 4 4v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a4 4 0 0 1 4-4ZM12 6V3m-2 0h4M8 12v2m8-2v2m-7 3h6M3 11H1m22 0h-2',
  book:'M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V3Z',
  send:'m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2',expand:'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
function localGet(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function localSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { showToast('Riwayat hanya tersimpan selama sesi ini karena penyimpanan browser dibatasi.'); } }
function showToast(message) {
  let toast = $('.portal-toast');
  if (!toast) { toast = document.createElement('div'); toast.className = 'portal-toast'; toast.setAttribute('role','status'); document.body.append(toast); }
  toast.textContent = message; toast.hidden = false; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, 4500);
}
let sources = [], catalogFailed = false, tab = 'all', query = '', busy = false, opened = false, returnFocus, historyMemory = [];
const labels = {verified:'Terverifikasi',candidate:'Kandidat sumber',unverified:'Belum diperiksa',catalogued:'Terdaftar di portal','portal-read':'HTML terbaca'};
function renderCatalog() {
  const visible = sources.filter(source => (tab === 'all' || (tab === 'metadata' ? ['metadata','text','csv'].includes(source.kind) : source.kind === 'catalog')) && `${source.title} ${source.description} ${source.publisher}`.toLocaleLowerCase('id').includes(query.toLocaleLowerCase('id')));
  $('#catalog-count').textContent = `${visible.length} sumber dalam prototipe`;
  $('#search-summary').hidden = !query;
  $('#search-summary-text').textContent = `Hasil pencarian untuk “${query}”`;
  $('#dataset-grid').innerHTML = catalogFailed ? '<div class="catalog-empty">Koleksi belum dapat dimuat. Periksa apakah server lokal masih berjalan.<br><button id="retry-catalog">Coba muat lagi</button></div>' : visible.length ? visible.map(source => `<article class="dataset-card"><div class="dataset-card-top"><span class="dataset-card-icon">${icon(source.kind === 'catalog' ? 'book' : 'database')}</span><span class="source-status ${esc(source.status)}">${esc(labels[source.status])}</span></div><h3>${esc(source.title)}</h3><p>${esc(source.description || 'Salinan sumber dalam koleksi lokal. Buka detail untuk melihat isi dan status pemeriksaan.')}</p><div class="dataset-card-footer"><span>${esc(source.publisher)}</span><a href="/chat?source=${encodeURIComponent(source.id)}">Lihat sumber ${icon('arrow-up-right')}</a></div></article>`).join('') : '<div class="catalog-empty">Belum ada sumber yang cocok dalam koleksi prototipe.<br>Hasil kosong tidak berarti data tersebut tidak tersedia di portal resmi.<br><a href="/chat?view=sources">Tambahkan sumber publik</a></div>';
}
async function loadCatalog() {
  try {
    const response = await fetch('/api/sources',{signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error();
    const body = await response.json();
    sources = body.sources.filter(source => ['candidate','verified','unverified'].includes(source.status)); catalogFailed = false;
    if(sources.some(source=>source.status==='verified') && !localGet('depok:public-default:v1',false)) {localSet('depok:scope:v1','verified');localSet('depok:public-default:v1',true);}
  } catch { catalogFailed = true; }
  renderCatalog();
}
function search(value) { query = value.trim().slice(0,150); $('#portal-query').value = query; tab = 'all'; updateTabs(); renderCatalog(); $('#data').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); }
function updateTabs() { document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active',button.dataset.tab === tab)); }
$('#portal-search').addEventListener('submit', event => { event.preventDefault(); search($('#portal-query').value); });
$('#reset-search').addEventListener('click', () => { query = ''; $('#portal-query').value = ''; renderCatalog(); $('#portal-query').focus(); });
$('#mobile-menu').addEventListener('click', () => { const isOpen = $('#mobile-menu').getAttribute('aria-expanded') !== 'true'; $('#mobile-menu').setAttribute('aria-expanded',String(isOpen)); $('#portal-navigation').classList.toggle('is-open',isOpen); });

function readHistory() {
  const history = localGet('depok:history:v1',historyMemory);
  return Array.isArray(history) && history.every(item => item && ['user','assistant','error'].includes(item.role)) ? history.slice(-60) : [];
}
function scope() { return localGet('depok:scope:v1','demo') === 'verified' ? 'verified' : 'demo'; }
function renderThread() {
  const history = readHistory();
  $('#widget-intro').hidden = history.length > 0;
  $('#widget-thread').hidden = history.length === 0 && !busy;
  $('#widget-thread').innerHTML = history.map(item => {
    if (item.role === 'user') return `<div class="mini-message user">${esc(item.text)}</div>`;
    if (item.role === 'error') return `<div class="mini-message error">${esc(item.text)}</div>`;
    const response = item.response || {};
    return `<div class="mini-message assistant"><div class="mini-assistant-label">ASISTEN DATA · ${response.scope === 'demo' ? 'LATIHAN' : 'KOLEKSI PUBLIK'}</div><p>${esc(response.answer)}</p>${(response.excerpts || []).map(excerpt => `<div class="mini-excerpt">${esc(excerpt.text)} [${esc(excerpt.sourceIndex)}]</div>`).join('')}${(response.sources || []).map(source => `<a class="mini-source" href="/chat?source=${encodeURIComponent(source.documentId)}"><span>${esc(labels[source.status] || (source.status === 'demo' ? 'Panduan latihan' : source.status))}</span>${esc(source.title)}</a>`).join('')}${response.notice ? `<div class="mini-notice">${esc(response.notice)}</div>` : ''}</div>`;
  }).join('') + (busy ? '<div class="mini-pending" role="status">Mencari bukti dalam koleksi…</div>' : '');
  $('#widget-scope').textContent = scope() === 'demo' ? 'Mode latihan · bukan statistik resmi' : 'Koleksi publik terverifikasi';
  if (history.length || busy) $('#widget-body').scrollTop = $('#widget-body').scrollHeight;
  else $('#widget-body').scrollTop = 0;
}
function openWidget(trigger = document.activeElement) {
  opened = true; returnFocus = trigger;
  $('#chat-nudge').hidden = true; $('#chat-widget').hidden = false; $('#chat-launcher').setAttribute('aria-expanded','true');
  $('#chat-launcher .launcher-symbol').innerHTML = icon('x');
  renderThread(); $('#close-widget').focus();
}
function closeWidget() {
  opened = false; $('#chat-widget').hidden = true; $('#chat-launcher').setAttribute('aria-expanded','false'); $('#chat-launcher .launcher-symbol').innerHTML = icon('bot');
  if (returnFocus?.isConnected) returnFocus.focus(); else $('#chat-launcher').focus();
}
$('#chat-launcher').addEventListener('click', () => opened ? closeWidget() : openWidget($('#chat-launcher')));
$('#close-widget').addEventListener('click',closeWidget);
$('#dismiss-nudge').addEventListener('click', () => { $('#chat-nudge').hidden = true; try { sessionStorage.setItem('depok:nudge-dismissed','true'); } catch {} });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (opened) closeWidget(); document.querySelectorAll('.nav-dropdown[open]').forEach(dropdown => { dropdown.open = false; }); $('#portal-navigation').classList.remove('is-open'); $('#mobile-menu').setAttribute('aria-expanded','false'); } });

async function askWidget(value) {
  if (busy) return;
  const question = value.trim(); if (!question) { $('#widget-question').focus(); return; }
  if (question.length > 2000) { showToast('Pertanyaan maksimal 2000 karakter.'); return; }
  const history = readHistory(), currentScope = scope();
  const last = history.at(-1);
  const previousQuestion = last?.role === 'assistant' && last.response?.scope === currentScope && history.at(-2)?.role === 'user' ? last.response.resolvedQuestion || history.at(-2).text : '';
  history.push({role:'user',text:question}); historyMemory = history; localSet('depok:history:v1',history.slice(-60));
  busy = true; $('#widget-send').disabled = true; $('#widget-question').value = ''; renderThread();
  // Store replies even when the popup is temporarily minimized.
  try {
    const response = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,scope:currentScope,useModel:true,previousQuestion}),signal:AbortSignal.timeout(115000)});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Permintaan gagal.');
    history.push({role:'assistant',response:body});
  } catch (error) { history.push({role:'error',text:`${error.message} Silakan coba kembali.`}); }
  finally { historyMemory = history.slice(-60); localSet('depok:history:v1',historyMemory); busy = false; $('#widget-send').disabled = false; renderThread(); if (opened) $('#widget-question').focus(); }
}
$('#widget-form').addEventListener('submit',event => { event.preventDefault(); askWidget($('#widget-question').value); });
document.addEventListener('click',event => {
  if (busy && event.target.closest('a[href^="/chat"]')) { event.preventDefault(); showToast('Tunggu jawaban selesai sebelum berpindah ke layar penuh.'); return; }
  const trigger = event.target.closest('[data-open-chat]'); if (trigger) openWidget(trigger);
  const quick = event.target.closest('[data-widget-question]'); if (quick) askWidget(quick.dataset.widgetQuestion);
  const term = event.target.closest('[data-search]'); if (term) search(term.dataset.search);
  const filter = event.target.closest('[data-tab]'); if (filter) { tab = filter.dataset.tab; updateTabs(); renderCatalog(); }
  const category = event.target.closest('[data-category]'); if (category) search(category.dataset.category);
  if (event.target.closest('#retry-catalog')) loadCatalog();
  if (event.target.closest('#portal-navigation a')) { $('#portal-navigation').classList.remove('is-open'); $('#mobile-menu').setAttribute('aria-expanded','false'); }
  if (!event.target.closest('.nav-dropdown')) document.querySelectorAll('.nav-dropdown[open]').forEach(dropdown => { dropdown.open = false; });
});
window.addEventListener('storage',event => { if (event.key?.startsWith('depok:') && !busy) renderThread(); });
setTimeout(() => { let dismissed = false; try { dismissed = sessionStorage.getItem('depok:nudge-dismissed') === 'true'; } catch {} if (!opened && !dismissed) $('#chat-nudge').hidden = false; },1600);
loadCatalog();
