import test from 'node:test';
import assert from 'node:assert/strict';
import {strToU8} from 'fflate';
import {detectFormat,inspectZip,extractAttachment,ExtractError,MAX_ARCHIVE_BYTES} from '../server/extract.js';
import {fixturePdf,fixtureXlsx} from './fixtures.js';

// Hand-built archive with one central-directory entry claiming 150 MB.
function lyingZip(uncompressed) {
  const bytes=new Uint8Array(88),view=new DataView(bytes.buffer);
  bytes.set([0x50,0x4b,0x03,0x04],0);
  view.setUint32(20,0x02014b50,true);
  view.setUint32(44,uncompressed,true);
  view.setUint32(66,0x06054b50,true);
  view.setUint16(66+10,1,true);
  view.setUint32(66+12,46,true);
  view.setUint32(66+16,20,true);
  return bytes;
}

test('format ditentukan oleh isi berkas, bukan ekstensi tautan',()=>{
  assert.equal(detectFormat(fixturePdf()),'pdf');
  assert.equal(detectFormat(fixtureXlsx()),'xlsx');
  assert.equal(detectFormat(new Uint8Array([0xd0,0xcf,0x11,0xe0,0,0])),'xls');
  assert.throws(()=>detectFormat(strToU8('<html>Request Rejected</html>'),{url:'https://satudata.depok.go.id/upload/file/a.pdf'}),error=>error instanceof ExtractError && error.code==='invalid_format');
});

test('arsip dengan ukuran deklarasi berlebih ditolak sebelum parser dijalankan',()=>{
  assert.throws(()=>inspectZip(lyingZip(150*1024*1024)),error=>error.code==='archive_too_large');
  assert.ok(MAX_ARCHIVE_BYTES>=100*1024*1024);
});

test('teks PDF diekstrak dan dipotong sesuai batas',async()=>{
  const full=await extractAttachment(fixturePdf('Profil kesehatan Kota Depok tahun 2025'));
  assert.equal(full.format,'pdf');assert.match(full.text,/Profil kesehatan/);assert.equal(full.truncated,false);assert.equal(full.detail.pages,1);
  const short=await extractAttachment(fixturePdf('Profil kesehatan Kota Depok tahun 2025'),{maxChars:30});
  assert.equal(short.truncated,true);assert.ok(short.text.length<=30);
});

test('baris XLSX diubah menjadi teks yang dapat dicari',async()=>{
  const result=await extractAttachment(fixtureXlsx(),{url:'https://satudata.depok.go.id/upload/file/data.xlsx'});
  assert.equal(result.format,'xlsx');assert.match(result.text,/Indikator \| Tahun \| Nilai/);assert.match(result.text,/Penanganan sampah \| 2025 \| 53.09/);assert.equal(result.truncated,false);
});

test('format yang tidak didukung ditandai, bukan dipaksa diekstrak',async()=>{
  for(const [bytes,pattern] of [[new Uint8Array([0xd0,0xcf,0x11,0xe0,0,0]),/\.xls/],[new Uint8Array([0x89,0x50,0x4e,0x47,0,0]),/Gambar/]]) {
    await assert.rejects(extractAttachment(bytes),error=>error.code==='unsupported_format' && pattern.test(error.message));
  }
});

test('PDF tanpa teks dilaporkan kosong tanpa mencoba OCR',async()=>{
  const content='BT ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[];
  for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const startxref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets)pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  await assert.rejects(extractAttachment(new Uint8Array(Buffer.from(pdf,'latin1'))),error=>error.code==='empty_text' && /OCR/.test(error.message));
});
