import {setTimeout as delay} from 'node:timers/promises';
import {PortalSyncError,portalUrl,robotsAllow} from './portal-sync.js';
import {ExtractError,MAX_ATTACHMENT_BYTES,MAX_ATTACHMENT_TEXT,extractAttachment} from './extract.js';

export const MAX_ATTACHMENTS_PER_BATCH=20;
const RETRY_COOLDOWN_MS=5*60*1000;
const SUPPORTED=/\.(?:pdf|xlsx)$/i;

// Content length is checked before the body is buffered, then again while it
// streams. The extractor re-checks the byte length and the archive directory.
async function readBytes(response) {
  if(!response.ok)throw new PortalSyncError(`HTTP ${response.status}`,response.status===403?'access_rejected':response.status===429?'rate_limited':response.status===404?'not_found':'http_error');
  const type=(response.headers.get('content-type') || '').toLowerCase();
  if(type.startsWith('text/html'))throw new PortalSyncError('Server mengembalikan halaman HTML, bukan berkas lampiran.','invalid_response');
  const declared=Number(response.headers.get('content-length') || '');
  if(Number.isFinite(declared) && declared>MAX_ATTACHMENT_BYTES)throw new PortalSyncError(`Lampiran melebihi batas ${Math.round(MAX_ATTACHMENT_BYTES/1024/1024)} MB.`,'too_large');
  if(!response.body)throw new PortalSyncError('Berkas lampiran kosong.','invalid_format');
  const chunks=[];let size=0;
  for await(const chunk of response.body){
    size+=chunk.length;
    if(size>MAX_ATTACHMENT_BYTES)throw new PortalSyncError(`Lampiran melebihi batas ${Math.round(MAX_ATTACHMENT_BYTES/1024/1024)} MB.`,'too_large');
    chunks.push(chunk);
  }
  if(!size)throw new PortalSyncError('Berkas lampiran kosong.','invalid_format');
  const bytes=new Uint8Array(Buffer.concat(chunks));
  // A portal error page can arrive with a PDF content type. Detect it before
  // handing the bytes to a parser, so it is recorded as blocked, not corrupt.
  const head=Buffer.from(bytes.buffer,bytes.byteOffset,Math.min(bytes.length,512)).toString('utf8').trim().toLowerCase();
  if(head.startsWith('<!doctype html') || head.startsWith('<html') || /request rejected|captcha|access denied/.test(head))throw new PortalSyncError('Server mengembalikan halaman HTML, bukan berkas lampiran.','access_rejected');
  return bytes;
}

const attachmentStatus=code=>code==='unsupported_format'?'skipped'
  :code==='empty_text'?'empty'
  :['access_rejected','redirect_rejected','rate_limited','invalid_response'].includes(code)?'blocked'
  :'failed';

export async function syncAttachments(store,{fetcher=fetch,maxAttachments=5,delayMs=900,signal,rules=[],onProgress}={}) {
  if(!Number.isInteger(maxAttachments) || maxAttachments<1 || maxAttachments>MAX_ATTACHMENTS_PER_BATCH)throw new PortalSyncError(`Batas lampiran harus 1–${MAX_ATTACHMENTS_PER_BATCH}.`,'invalid_limit');
  if(!Number.isFinite(delayMs) || delayMs<500)throw new PortalSyncError('Jeda minimal 500 ms agar tidak membebani portal.','invalid_delay');
  let processed=0,failed=0;
  const headers={'User-Agent':'AsistenDataDepok/0.4 (public portal inventory)','Accept':'application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.8'};
  while(processed<maxAttachments) {
    signal?.throwIfAborted();
    const page=store.portal.nextAttachment(new Date(Date.now()-RETRY_COOLDOWN_MS).toISOString());
    if(!page)break;
    if(processed)await delay(delayMs,undefined,{signal});
    try {
      const target=portalUrl(page.url);
      if(!SUPPORTED.test(target.pathname))throw new PortalSyncError('Jenis lampiran ini belum diekstrak; hanya PDF dan XLSX.','unsupported_format');
      if(!robotsAllow(target.href,rules))throw new PortalSyncError('Dilarang oleh robots.txt.','access_rejected');
      const response=await fetcher(target.href,{headers,redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
      if(response.status>=300 && response.status<400)throw new PortalSyncError('Pengalihan berkas perlu ditinjau pengelola.','redirect_rejected');
      const bytes=await readBytes(response);
      // pdf.js may transfer (detach) the underlying buffer, so record the size
      // before extraction instead of reading bytes.length afterwards.
      const byteLength=bytes.length;
      const result=await extractAttachment(bytes,{url:target.href,maxChars:MAX_ATTACHMENT_TEXT});
      store.portal.saveAttachment(page.url,{...result,contentType:response.headers.get('content-type') || '',bytes:byteLength});
    } catch(error) {
      if(signal?.aborted)throw error;
      const code=error?.code || 'extract_failed',status=attachmentStatus(code);
      store.portal.failAttachment(page.url,error instanceof ExtractError || error instanceof PortalSyncError?error.message:'Lampiran gagal diproses.',status);
      failed++;
      processed++;
      onProgress?.({processed,failed,url:page.url,status});
      if(code==='rate_limited')break;
      continue;
    }
    processed++;
    onProgress?.({processed,failed,url:page.url,status:store.portal.getPage(page.url)?.status});
  }
  return {processed,failed};
}
