import {getDocumentProxy,extractText} from 'unpdf';
import {readSheet} from 'read-excel-file/node';

// Attachments are read as text only. There is no OCR, no macro execution and no
// formula evaluation: a PDF/XLSX that contains no selectable text stays empty.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT = 2_000_000;
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 5000;
const MAX_PDF_PAGES = 5000;
const MAX_SHEET_ROWS = 50_000;
const MAX_SHEET_COLUMNS = 200;

export class ExtractError extends Error {
  constructor(message,code='extract_failed'){super(message);this.name='ExtractError';this.code=code;}
}

export const cleanExtractedText=value=>String(value ?? '')
  .replace(/\r\n?/g,'\n')
  .replace(/[ \t]+\n/g,'\n')
  .replace(/\n{3,}/g,'\n\n')
  .trim();

// A ZIP central-directory scan runs before any parser sees the archive. It
// rejects encrypted archives and archives whose declared uncompressed size or
// entry count is too large, which is the cheap first line of zip-bomb defence.
export function inspectZip(bytes) {
  if(!(bytes instanceof Uint8Array) || bytes.length<22)throw new ExtractError('Struktur arsip tidak dikenali.','invalid_archive');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const endSignature=0x06054b50;
  const earliest=Math.max(0,bytes.length-65557);
  let end=-1;
  for(let offset=bytes.length-22;offset>=earliest;offset--){
    if(view.getUint32(offset,true)===endSignature){end=offset;break;}
  }
  if(end<0)throw new ExtractError('Struktur arsip XLSX tidak dikenali.','invalid_archive');
  const entries=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),directoryOffset=view.getUint32(end+16,true);
  if(entries===0xffff || directorySize===0xffffffff || directoryOffset===0xffffffff)throw new ExtractError('Arsip memakai format ZIP64 yang belum didukung.','invalid_archive');
  if(entries>MAX_ARCHIVE_ENTRIES)throw new ExtractError(`Arsip memuat ${entries} entri; batas ${MAX_ARCHIVE_ENTRIES}.`,'archive_too_large');
  if(directoryOffset+directorySize>bytes.length)throw new ExtractError('Direktori arsip berada di luar berkas.','invalid_archive');
  let declaredBytes=0,offset=directoryOffset;
  const names=[];
  for(let index=0;index<entries;index++){
    if(offset+46>bytes.length || view.getUint32(offset,true)!==0x02014b50)throw new ExtractError('Direktori arsip rusak.','invalid_archive');
    const flags=view.getUint16(offset+8,true),compressed=view.getUint32(offset+20,true),uncompressed=view.getUint32(offset+24,true);
    const nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true);
    if(flags&1)throw new ExtractError('Arsip terenkripsi tidak didukung.','encrypted_archive');
    if(compressed===0xffffffff || uncompressed===0xffffffff)throw new ExtractError('Ukuran entri arsip tidak dapat dipastikan.','archive_too_large');
    declaredBytes+=uncompressed;
    if(declaredBytes>MAX_ARCHIVE_BYTES)throw new ExtractError(`Isi arsip melebihi batas ${Math.round(MAX_ARCHIVE_BYTES/1024/1024)} MB.`,'archive_too_large');
    if(offset+46+nameLength+extraLength+commentLength>bytes.length)throw new ExtractError('Direktori arsip rusak.','invalid_archive');
    names.push(Buffer.from(bytes.buffer,bytes.byteOffset+offset+46,nameLength).toString('utf8'));
    offset+=46+nameLength+extraLength+commentLength;
  }
  return {entries,uncompressed:declaredBytes,names};
}

// The file extension is only a hint. The first bytes decide what the file is,
// so an HTML error page saved as ".pdf" is not parsed as a PDF.
export function detectFormat(bytes,{url=''}={}) {
  if(!(bytes instanceof Uint8Array) || !bytes.length)throw new ExtractError('Berkas lampiran kosong.','invalid_format');
  const head=Buffer.from(bytes.buffer,bytes.byteOffset,Math.min(bytes.length,8));
  if(head.subarray(0,5).toString('latin1')==='%PDF-')return 'pdf';
  if(head[0]===0x50 && head[1]===0x4b && [0x03,0x05,0x07].includes(head[2]) && [0x04,0x06,0x08].includes(head[3])) {
    const archive=inspectZip(bytes);
    if(archive.names.includes('xl/workbook.xml') && archive.names.includes('[Content_Types].xml'))return 'xlsx';
    if(archive.names.includes('word/document.xml'))return 'docx';
    return 'zip';
  }
  if(head[0]===0xd0 && head[1]===0xcf && head[2]===0x11 && head[3]===0xe0)return 'xls';
  if([0x89,0x50,0x4e,0x47].every((value,index)=>head[index]===value) || (head[0]===0xff && head[1]===0xd8))return 'image';
  let extension='';
  try{extension=new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || '';}catch{ /* URL is validated by the caller. */ }
  if(/^(?:pdf|xlsx?)$/.test(extension))throw new ExtractError('Isi berkas tidak cocok dengan ekstensinya; bukan PDF atau XLSX yang dikenali.','invalid_format');
  return 'unknown';
}

function unsupported(format) {
  if(format==='xls')return new ExtractError('Berkas .xls lama belum didukung; simpan ulang sebagai .xlsx atau PDF lalu jalankan ulang.','unsupported_format');
  if(format==='image')return new ExtractError('Gambar tidak diekstrak; OCR tidak dijalankan.','unsupported_format');
  if(format==='docx')return new ExtractError('Dokumen Word belum didukung; hanya PDF dan XLSX.','unsupported_format');
  if(format==='zip')return new ExtractError('Arsip ZIP belum didukung; hanya PDF dan XLSX.','unsupported_format');
  return new ExtractError('Format lampiran belum didukung; hanya PDF dan XLSX.','unsupported_format');
}

async function extractPdf(bytes,maxChars) {
  let pdf;
  try{pdf=await getDocumentProxy(bytes,{verbosity:0});}
  catch{throw new ExtractError('PDF tidak dapat dibaca; berkas mungkin rusak atau dilindungi.','invalid_pdf');}
  try{
    if(pdf.numPages>MAX_PDF_PAGES)throw new ExtractError(`PDF memuat ${pdf.numPages} halaman; batas ${MAX_PDF_PAGES}.`,'too_large');
    const {text}=await extractText(pdf,{mergePages:true});
    const cleaned=cleanExtractedText(text);
    if(!cleaned)throw new ExtractError('PDF tidak memuat teks yang dapat diekstrak; kemungkinan hasil pindai. OCR tidak dijalankan.','empty_text');
    return {format:'pdf',text:cleaned.slice(0,maxChars),truncated:cleaned.length>maxChars,detail:{pages:pdf.numPages}};
  }catch(error){
    if(error instanceof ExtractError)throw error;
    throw new ExtractError('Teks PDF gagal diekstrak.','extract_failed');
  }finally{await pdf.destroy?.();}
}

const cellText=value=>{
  if(value===null || value===undefined)return '';
  if(value instanceof Date)return Number.isNaN(value.getTime())?'':value.toISOString().slice(0,10);
  return String(value).replace(/\s+/g,' ').trim();
};

async function extractXlsx(bytes,maxChars) {
  let rows;
  try{rows=await readSheet(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength));}
  catch{throw new ExtractError('XLSX tidak dapat dibaca; berkas mungkin rusak atau dilindungi.','invalid_xlsx');}
  if(!Array.isArray(rows) || !rows.length)throw new ExtractError('XLSX tidak memuat baris yang dapat dibaca.','empty_text');
  const lines=[];
  let length=0,truncated=false,usedRows=0;
  for(const row of rows){
    if(!Array.isArray(row))continue;
    if(usedRows>=MAX_SHEET_ROWS){truncated=true;break;}
    usedRows++;
    const line=row.slice(0,MAX_SHEET_COLUMNS).map(cellText).filter(Boolean).join(' | ');
    if(!line)continue;
    length+=line.length+1;
    if(length>maxChars){lines.push(line.slice(0,Math.max(0,maxChars-(length-line.length))));truncated=true;break;}
    lines.push(line);
  }
  const cleaned=cleanExtractedText(lines.join('\n'));
  if(!cleaned)throw new ExtractError('XLSX tidak memuat teks yang dapat dibaca.','empty_text');
  return {format:'xlsx',text:cleaned,truncated,detail:{rows:usedRows}};
}

export async function extractAttachment(bytes,{url='',maxChars=MAX_ATTACHMENT_TEXT}={}) {
  if(!(bytes instanceof Uint8Array) || !bytes.length)throw new ExtractError('Berkas lampiran kosong.','invalid_format');
  if(bytes.length>MAX_ATTACHMENT_BYTES)throw new ExtractError(`Lampiran melebihi batas ${Math.round(MAX_ATTACHMENT_BYTES/1024/1024)} MB.`,'too_large');
  if(!Number.isInteger(maxChars) || maxChars<1 || maxChars>MAX_ATTACHMENT_TEXT)throw new ExtractError('Batas teks lampiran tidak valid.','invalid_limit');
  const format=detectFormat(bytes,{url});
  if(format==='pdf')return extractPdf(bytes,maxChars);
  if(format==='xlsx')return extractXlsx(bytes,maxChars);
  throw unsupported(format);
}
