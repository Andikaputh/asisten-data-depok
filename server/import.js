import { parse } from 'csv-parse/sync';

export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function field(value, name, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max) throw new UserError(`${name} tidak valid (maksimal ${max} karakter).`);
  const result = value.trim();
  if (required && !result) throw new UserError(`${name} perlu diisi.`);
  return result;
}

export function validateImport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UserError('Format dokumen tidak valid.');
  const title = field(body.title, 'Judul', 200, true);
  const publisher = field(body.publisher, 'Penerbit', 150, true);
  const sourceUrl = field(body.sourceUrl, 'URL sumber', 1500, true);
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { throw new UserError('URL sumber harus berupa tautan HTTPS.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new UserError('Gunakan URL sumber publik HTTPS tanpa kredensial.');
  const content = field(body.content, 'Isi dokumen', 500_000, true);
  if (content.length < 30) throw new UserError('Isi dokumen terlalu pendek. Masukkan minimal 30 karakter.');
  const year = field(body.year, 'Tahun observasi', 4);
  if (year && !/^(19|20)\d{2}$/.test(year)) throw new UserError('Tahun observasi harus empat digit; kosongkan jika tidak diketahui.');
  const region = field(body.region, 'Wilayah', 150);
  const kind = body.kind === 'csv' ? 'csv' : 'text';
  const filename = field(body.filename, 'Nama berkas', 200);
  let observations = [];
  if (kind === 'csv') observations = parseObservations(content);
  return {
    document: { title, publisher, sourceUrl: parsed.href, content, kind, year: year || null, region: region || null, filename: filename || null, description: field(body.description, 'Deskripsi', 500), status: 'unverified' },
    observations,
  };
}

export function parseObservations(content) {
  let records;
  try { records = parse(content, { columns: true, skip_empty_lines: true, bom: true, trim: true }); }
  catch { throw new UserError('CSV tidak dapat dibaca. Gunakan pemisah koma dan tanda kutip untuk nilai berkoma.'); }
  const required = ['indicator','year','region','value','unit'];
  if (!records.length || records.length > 5000 || required.some(key => !(key in records[0]))) throw new UserError('CSV harus berisi 1–5000 baris dengan header indicator,year,region,value,unit.');
  const unique = new Set();
  return records.map((row, index) => {
    if (required.some(key => !row[key])) throw new UserError(`CSV baris ${index + 2}: semua kolom wajib diisi; nilai kosong tidak dianggap nol.`);
    // Canonical format deliberately rejects ambiguous thousands/decimal separators.
    if (!/^-?\d+(\.\d+)?$/.test(row.value) || !Number.isFinite(Number(row.value))) throw new UserError(`CSV baris ${index + 2}: nilai harus numerik dengan titik desimal tanpa pemisah ribuan. Normalisasi dari sumber terlebih dahulu.`);
    if (!/^(19|20)\d{2}$/.test(row.year)) throw new UserError(`CSV baris ${index + 2}: tahun tidak valid.`);
    const indicator = field(row.indicator, 'Indikator', 300, true);
    const region = field(row.region, 'Wilayah', 150, true);
    const unit = field(row.unit, 'Satuan', 100, true);
    const key = [indicator, row.year, region, unit].map(x => x.toLowerCase()).join('|');
    if (unique.has(key)) throw new UserError(`CSV baris ${index + 2}: observasi duplikat; periksa dimensi data sebelum impor.`);
    unique.add(key);
    return { indicator, year: row.year, region, valueRaw: row.value, value: Number(row.value), unit, rowNumber: index + 2 };
  });
}
