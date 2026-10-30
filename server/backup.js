import { createHash } from 'node:crypto';
import { UserError } from './import.js';
import { PORTAL_ORIGIN, PORTAL_SECTIONS } from './portal-sync.js';
import { APP_VERSION } from './version.js';

export const BACKUP_FORMAT = 'asisten-data-depok-backup';
export const BACKUP_VERSION = 2;
// A local backup can include thousands of catalog pages; the HTTP endpoint
// refuses anything larger so a mistaken upload cannot exhaust memory.
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

const MAX_DOCUMENTS = 100;
const MAX_OBSERVATIONS_PER_DOCUMENT = 5000;
const MAX_PORTAL_ITEMS = 50000;
const MAX_PORTAL_PAGES = 50000;
const MAX_PORTAL_RUNS = 10000;
const DOCUMENT_CONTENT_LIMIT = 500_000;
const PAGE_BODY_LIMIT = 2_000_000;
const SECTIONS = new Set(PORTAL_SECTIONS.map(section => section[0]));
const DOCUMENT_STATUSES = new Set(['candidate','unverified','verified','demo','withdrawn']);
const PAGE_KINDS = new Set(['guide','listing','detail','attachment','external']);
const PAGE_STATUSES = new Set(['pending','fetched','empty','skipped','partial','failed','blocked','unread','external']);
const RUN_STATUSES = new Set(['running','completed','paused','interrupted','cancelled','failed']);

const sha256 = value => createHash('sha256').update(String(value ?? '')).digest('hex');

function text(value, max, label, { required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new UserError(`${label} tidak valid${required ? '' : ' atau tidak lengkap'} (maksimal ${max} karakter).`);
  }
  return value;
}
function nullable(value, max, label) {
  if (value === undefined || value === null || value === '') return null;
  return text(value, max, label);
}
function https(value, label, { optional = false } = {}) {
  if (!value) {
    if (optional) return '';
    throw new UserError(`${label} wajib diisi.`);
  }
  if (typeof value !== 'string' || value.length > 1500) throw new UserError(`${label} tidak valid.`);
  let url;
  try { url = new URL(value); } catch { throw new UserError(`${label} harus berupa tautan HTTPS.`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new UserError(`${label} harus berupa tautan HTTPS tanpa kredensial.`);
  return value;
}
function timestamp(value, label, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new UserError(`${label} bukan tanggal yang valid.`);
  return new Date(value).toISOString();
}
function integer(value, min, max, label, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new UserError(`${label} harus bilangan bulat ${min}–${max}.`);
  return value;
}

function normalizeDocument(raw, index) {
  const label = `Dokumen #${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError(`${label}: format tidak valid.`);
  const id = text(raw.id, 64, `${label}: ID`, { required:true });
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new UserError(`${label}: ID hanya boleh huruf, angka, dan tanda hubung.`);
  const content = text(raw.content, DOCUMENT_CONTENT_LIMIT, `${label}: isi`);
  const hash = text(raw.hash, 64, `${label}: hash`, { required:true });
  // Integrity check: a damaged or hand-edited backup must not silently become evidence.
  if (hash !== sha256(content)) throw new UserError(`${label}: hash isi tidak cocok. Berkas cadangan rusak atau sudah diubah; pemulihan dibatalkan.`);
  const status = text(raw.status, 20, `${label}: status`, { required:true });
  if (!DOCUMENT_STATUSES.has(status)) throw new UserError(`${label}: status "${status}" tidak dikenal.`);
  const sourceUrl = https(raw.sourceUrl, `${label}: URL sumber`, { optional:true });
  const year = nullable(raw.year, 4, `${label}: tahun`);
  if (year && !/^(19|20)\d{2}$/.test(year)) throw new UserError(`${label}: tahun observasi harus empat digit.`);
  const value = {
    id,
    title: text(raw.title, 200, `${label}: judul`, { required:true }).trim(),
    kind: text(raw.kind, 40, `${label}: jenis`, { required:true }),
    publisher: text(raw.publisher, 300, `${label}: penerbit`),
    sourceUrl,
    description: text(raw.description, 3000, `${label}: deskripsi`),
    content,
    status,
    year,
    region: nullable(raw.region, 150, `${label}: wilayah`),
    unit: nullable(raw.unit, 100, `${label}: satuan`),
    filename: nullable(raw.filename, 200, `${label}: nama berkas`),
    retrievedAt: timestamp(raw.retrievedAt, `${label}: waktu impor`, new Date().toISOString()),
    reviewedAt: timestamp(raw.reviewedAt, `${label}: waktu tinjau`),
    reviewer: nullable(raw.reviewer, 120, `${label}: peninjau`),
    hash,
    version: integer(raw.version, 1, 1000, `${label}: versi`, 1),
    sourceUpdatedAt: nullable(raw.sourceUpdatedAt, 40, `${label}: pembaruan sumber`),
    provenance: nullable(raw.provenance, 4000, `${label}: asal-usul`),
  };
  if (value.status === 'verified' && !value.content) throw new UserError(`${label}: dokumen terverifikasi harus memiliki isi.`);
  return value;
}

function normalizeObservation(raw, documentId, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError(`${label}: format observasi tidak valid.`);
  const indicator = text(raw.indicator, 300, `${label}: indikator`, { required:true }).trim();
  const year = text(raw.year, 4, `${label}: tahun`, { required:true });
  if (!/^(19|20)\d{2}$/.test(year)) throw new UserError(`${label}: tahun tidak valid.`);
  const region = text(raw.region, 150, `${label}: wilayah`, { required:true }).trim();
  const unit = text(raw.unit, 100, `${label}: satuan`, { required:true }).trim();
  const valueRaw = text(raw.valueRaw, 40, `${label}: nilai`, { required:true });
  if (!/^-?\d+(\.\d+)?$/.test(valueRaw)) throw new UserError(`${label}: nilai harus angka dengan titik desimal tanpa pemisah ribuan.`);
  const numeric = Number(valueRaw);
  if (!Number.isFinite(numeric) || raw.value !== numeric) throw new UserError(`${label}: nilai tidak konsisten dengan nilai mentahnya.`);
  return { documentId, indicator, year, region, valueRaw, value:numeric, unit, rowNumber:integer(raw.rowNumber, 1, 1_000_000, `${label}: nomor baris`, 1) };
}

function normalizeItem(raw, index) {
  const label = `Entri portal #${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError(`${label}: format tidak valid.`);
  const section = text(raw.section, 40, `${label}: bagian`, { required:true });
  if (!SECTIONS.has(section)) throw new UserError(`${label}: bagian "${section}" tidak dikenal.`);
  return {
    id: text(raw.id, 80, `${label}: ID`, { required:true }),
    url: https(raw.url, `${label}: URL`),
    title: text(raw.title, 500, `${label}: judul`, { required:true }).trim(),
    section,
    publisher: text(raw.publisher, 300, `${label}: penerbit`),
    description: text(raw.description, 3000, `${label}: deskripsi`),
    periodLabel: text(raw.periodLabel, 200, `${label}: periode`),
    format: text(raw.format, 40, `${label}: format`),
    discoveredFrom: https(raw.discoveredFrom, `${label}: halaman asal`, { optional:true }),
    firstSeenAt: timestamp(raw.firstSeenAt, `${label}: pertama terlihat`, new Date().toISOString()),
    lastSeenAt: timestamp(raw.lastSeenAt, `${label}: terakhir terlihat`, new Date().toISOString()),
    identityKey: text(raw.identityKey, 2000, `${label}: identitas`, { required:true }),
  };
}

function normalizePage(raw, index) {
  const label = `Halaman portal #${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError(`${label}: format tidak valid.`);
  const url = https(raw.url, `${label}: URL`);
  const parsed = new URL(url);
  if (parsed.origin !== PORTAL_ORIGIN) throw new UserError(`${label}: hanya halaman domain portal yang dapat dipulihkan.`);
  const kind = text(raw.kind, 20, `${label}: jenis`, { required:true });
  if (!PAGE_KINDS.has(kind)) throw new UserError(`${label}: jenis "${kind}" tidak dikenal.`);
  const status = text(raw.status, 20, `${label}: status`, { required:true });
  if (!PAGE_STATUSES.has(status)) throw new UserError(`${label}: status "${status}" tidak dikenal.`);
  const body = text(raw.body, PAGE_BODY_LIMIT, `${label}: isi`);
  const hash = nullable(raw.hash, 64, `${label}: hash`);
  if (hash && hash !== sha256(body)) throw new UserError(`${label}: hash isi tidak cocok. Berkas cadangan rusak atau sudah diubah; pemulihan dibatalkan.`);
  return {
    url,
    kind,
    section: text(raw.section, 40, `${label}: bagian`, { required:true }),
    discoveredFrom: https(raw.discoveredFrom, `${label}: halaman asal`, { optional:true }),
    status,
    title: text(raw.title, 500, `${label}: judul`),
    body,
    hash: hash || sha256(body),
    attemptedAt: timestamp(raw.attemptedAt, `${label}: waktu percobaan`),
    fetchedAt: timestamp(raw.fetchedAt, `${label}: waktu pengambilan`),
    error: nullable(raw.error, 500, `${label}: galat`),
    attempts: integer(raw.attempts, 0, 1_000_000, `${label}: jumlah percobaan`, 0),
  };
}

function normalizeRun(raw, index) {
  const label = `Batch sinkronisasi #${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError(`${label}: format tidak valid.`);
  const status = text(raw.status, 20, `${label}: status`, { required:true });
  if (!RUN_STATUSES.has(status)) throw new UserError(`${label}: status "${status}" tidak dikenal.`);
  const startedAt = timestamp(raw.startedAt, `${label}: waktu mulai`, new Date().toISOString());
  return {
    id: text(raw.id, 64, `${label}: ID`, { required:true }),
    startedAt,
    finishedAt: timestamp(raw.finishedAt, `${label}: waktu selesai`, status === 'running' ? new Date().toISOString() : null),
    // A restored run never owns a live process, so it must not block new batches.
    status: status === 'running' ? 'interrupted' : status,
    processed: integer(raw.processed, 0, 10_000_000, `${label}: diproses`, 0),
    failed: integer(raw.failed, 0, 10_000_000, `${label}: gagal`, 0),
    note: text(raw.note, 500, `${label}: catatan`),
  };
}

export function normalizeBackup(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new UserError('Berkas cadangan tidak valid.');
  if (payload.format !== undefined && payload.format !== BACKUP_FORMAT) throw new UserError('Berkas ini bukan cadangan Asisten Data Depok.');
  if (!Number.isInteger(payload.version) || payload.version < 1 || payload.version > BACKUP_VERSION) {
    throw new UserError(`Versi cadangan ${payload.version ?? '(tidak ada)'} tidak didukung. Versi aplikasi ini menerima 1–${BACKUP_VERSION}.`);
  }
  if (!Array.isArray(payload.documents)) throw new UserError('Cadangan tidak memuat daftar dokumen.');
  if (payload.documents.length > MAX_DOCUMENTS) throw new UserError(`Cadangan memuat lebih dari batas prototipe ${MAX_DOCUMENTS} dokumen.`);

  const documents = payload.documents.map(normalizeDocument);
  const seen = new Set();
  for (const document of documents) {
    if (seen.has(document.id)) throw new UserError(`Cadangan memuat ID dokumen ganda: ${document.id}.`);
    seen.add(document.id);
  }

  const observationsByDocument = new Map();
  const rawObservations = payload.observations ?? [];
  if (!Array.isArray(rawObservations)) throw new UserError('Daftar observasi pada cadangan tidak valid.');
  rawObservations.forEach((raw, index) => {
    const documentId = raw?.documentId;
    if (!seen.has(documentId)) throw new UserError(`Observasi #${index + 1} merujuk dokumen yang tidak ada dalam cadangan.`);
    const list = observationsByDocument.get(documentId) || [];
    if (list.length >= MAX_OBSERVATIONS_PER_DOCUMENT) throw new UserError(`Observasi dokumen ${documentId} melebihi batas ${MAX_OBSERVATIONS_PER_DOCUMENT} baris.`);
    list.push(normalizeObservation(raw, documentId, `Observasi #${index + 1}`));
    observationsByDocument.set(documentId, list);
  });
  for (const [documentId, list] of observationsByDocument) {
    const unique = new Set();
    for (const row of list) {
      const key = [row.indicator,row.year,row.region,row.unit].map(part => part.toLowerCase()).join('|');
      if (unique.has(key)) throw new UserError(`Dokumen ${documentId}: observasi duplikat untuk ${row.indicator} ${row.year} ${row.region}.`);
      unique.add(key);
    }
  }

  const portal = payload.portal ?? {};
  if (!portal || typeof portal !== 'object' || Array.isArray(portal)) throw new UserError('Bagian portal pada cadangan tidak valid.');
  const items = portal.items ?? [], pages = portal.pages ?? [], runs = portal.runs ?? [];
  if (!Array.isArray(items) || items.length > MAX_PORTAL_ITEMS) throw new UserError(`Daftar entri portal tidak valid atau melebihi ${MAX_PORTAL_ITEMS} baris.`);
  if (!Array.isArray(pages) || pages.length > MAX_PORTAL_PAGES) throw new UserError(`Daftar halaman portal tidak valid atau melebihi ${MAX_PORTAL_PAGES} baris.`);
  if (!Array.isArray(runs) || runs.length > MAX_PORTAL_RUNS) throw new UserError(`Daftar batch sinkronisasi tidak valid atau melebihi ${MAX_PORTAL_RUNS} baris.`);
  const metadata = portal.metadata ?? {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new UserError('Metadata portal pada cadangan tidak valid.');
  const normalizedMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(key) || typeof value !== 'string' || value.length > 5000) throw new UserError(`Metadata portal "${key}" tidak valid.`);
    normalizedMetadata[key] = value;
  }

  return {
    version: payload.version,
    exportedAt: payload.exportedAt ?? null,
    documents,
    observationsByDocument,
    observationCount: rawObservations.length,
    portal: {
      items: items.map(normalizeItem),
      pages: pages.map(normalizePage),
      runs: runs.map(normalizeRun),
      metadata: normalizedMetadata,
    },
  };
}

export function buildBackup(store) {
  const documents = store.list();
  const observations = store.allObservations();
  const items = store.db.prepare('SELECT * FROM portal_items ORDER BY rowid').all();
  const pages = store.db.prepare('SELECT * FROM portal_pages ORDER BY rowid').all();
  const runs = store.db.prepare('SELECT * FROM portal_sync_runs ORDER BY startedAt,rowid').all();
  const metadata = Object.fromEntries(store.db.prepare('SELECT key,value FROM portal_metadata').all().map(row => [row.key,row.value]));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    summary: {
      documents: documents.length,
      verified: documents.filter(document => document.status === 'verified').length,
      observations: observations.length,
      portalItems: items.length,
      portalPages: pages.length,
      contentPages: pages.filter(page => page.status === 'fetched' && page.body && (['guide','detail'].includes(page.kind) || page.section === 'gallery')).length,
    },
    documents,
    observations,
    portal: { items, pages, runs, metadata },
  };
}

export function restoreBackup(store, payload, { asUnverified = false, dryRun = false } = {}) {
  const backup = normalizeBackup(payload);
  const downgraded = asUnverified ? backup.documents.filter(document => document.status === 'verified') : [];
  const documents = downgraded.length
    ? backup.documents.map(document => document.status === 'verified' ? { ...document, status:'unverified', reviewer:null, reviewedAt:null } : document)
    : backup.documents;

  if (dryRun) {
    const duplicateQuery = store.db.prepare("SELECT id FROM documents WHERE hash=? AND sourceUrl=? AND status!='withdrawn' AND content!=''");
    let skipped = 0, duplicate = 0;
    for (const document of documents) {
      if (store.get(document.id)) skipped++;
      else if (duplicateQuery.get(document.hash, document.sourceUrl)) duplicate++;
    }
    return {
      dryRun: true,
      formatVersion: backup.version,
      asUnverified,
      documents: { received:documents.length, added:documents.length - skipped - duplicate, duplicate, skipped },
      observations: { received:backup.observationCount, added:0 },
      portal: { received:{ items:backup.portal.items.length, pages:backup.portal.pages.length }, items:0, pages:0, runs:0, metadata:0 },
      warnings: restoreWarnings(backup, asUnverified, true),
    };
  }

  const documentCounts = store.restoreDocuments(documents, backup.observationsByDocument);
  const portalCounts = store.portal.restore(backup.portal);
  return {
    dryRun: false,
    formatVersion: backup.version,
    asUnverified,
    documents: { received:documents.length, ...documentCounts, downgraded:downgraded.length },
    observations: { received:backup.observationCount, added:documentCounts.observations },
    portal: { received:{ items:backup.portal.items.length, pages:backup.portal.pages.length }, ...portalCounts },
    warnings: restoreWarnings(backup, asUnverified, false),
  };
}

function restoreWarnings(backup, asUnverified, dryRun) {
  const warnings = [];
  if (asUnverified && backup.documents.some(document => document.status === 'verified')) {
    warnings.push('Dokumen terverifikasi diturunkan menjadi belum diperiksa; tinjau ulang sebelum dipakai sebagai bukti.');
  } else if (backup.documents.some(document => document.status === 'verified')) {
    warnings.push('Status verifikasi ikut dipulihkan dari berkas. Hash menjaga keutuhan isi, bukan membuktikan peninjauan manusia: pulihkan hanya cadangan milik sendiri.');
  }
  if (backup.portal.pages.length) warnings.push('Halaman portal dipulihkan apa adanya; status "terbaca" tetap berarti ekstraksi otomatis, bukan peninjauan manual.');
  if (backup.portal.items.length) warnings.push('Entri katalog tidak menjadi bukti nilai statistik; angka tetap hanya dibaca dari tabel yang ditinjau.');
  if (dryRun) warnings.push('Mode uji coba: tidak ada data yang ditulis.');
  return warnings;
}
