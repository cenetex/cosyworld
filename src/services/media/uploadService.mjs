/**
 * UploadService
 * Bridges cosyworld to the serverless upload API (create/parts/complete)
 * - Supports single-part and multipart uploads
 * - Streams file parts directly to S3 using presigned URLs
 * - Returns the final S3 key and optional CDN URL
 */

import fs from 'fs';
import path from 'path';
let AbortControllerRef = globalThis.AbortController;
try { if (!AbortControllerRef) { ({ default: AbortControllerRef } = await import('abort-controller')); } } catch {}

const DEFAULT_TIMEOUT_MS = 60_000; // per network call

export class UploadService {
  /**
   * @param {Object} opts
   * @param {Console|Object} [opts.logger]
   * @param {string} [opts.apiBaseUrl] - e.g. https://xxxx.execute-api.<region>.amazonaws.com/prod
   * @param {string} [opts.cdnDomain] - e.g. dxxxx.cloudfront.net (optional)
   */
  constructor({ logger, apiBaseUrl, cdnDomain } = {}) {
    this.logger = logger || console;
    this.apiBaseUrl = apiBaseUrl || process.env.UPLOAD_API_BASE_URL || process.env.S3_API_ENDPOINT; // fallback if reused
    this.cdnDomain = cdnDomain || process.env.CLOUDFRONT_DOMAIN || '';

    if (!this.apiBaseUrl) {
      throw new Error('[UploadService] Missing UPLOAD_API_BASE_URL');
    }

    if (typeof fetch !== 'function') {
      throw new Error('[UploadService] global fetch is required (Node 18+)');
    }
  }

  /**
   * Upload a local file via the upload API. Returns { key, cdnUrl, status }
   * @param {string} filePath
   * @param {Object} [options]
   * @param {string} [options.contentType] - e.g. image/png, video/mp4
   */
  async uploadFile(filePath, { contentType } = {}) {
    const stat = await fs.promises.stat(filePath);
    const size = stat.size;
    const ext = path.extname(filePath).replace(/^\./, '') || 'bin';
    const ct = contentType || guessContentType(ext);

    // 1) Create upload session
    const createRes = await this.#jsonFetch(`${this.apiBaseUrl}/video/upload/create`, {
      method: 'POST',
      body: JSON.stringify({ fileSizeBytes: size, contentType: ct, fileExtension: ext }),
    });

    if (!createRes?.uploadType) throw new Error(`[UploadService] Invalid create response: ${JSON.stringify(createRes)}`);

    const { uploadSessionId, uploadType, key } = createRes;

    if (uploadType === 'single') {
      // 2) PUT file to the presigned URL (send with explicit Content-Length to avoid chunked transfer)
      const putUrl = createRes.putUrl;
      await this.#putFile(putUrl, filePath, ct, size);

      // 3) Finalize
      await this.#jsonFetch(`${this.apiBaseUrl}/video/upload/complete`, {
        method: 'POST',
        body: JSON.stringify({ uploadSessionId }),
      });
      return { key, cdnUrl: this.#cdnUrlFor(key), status: 'uploaded' };
    }

    // Multipart - stream by partSize
    const partSize = createRes.partSize;
    const totalParts = createRes.totalParts;
    const ids = Array.from({ length: totalParts }, (_, i) => i + 1);

    // Request URLs in manageable batches (e.g., 8 at a time)
    const BATCH = 8;
    const etags = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunkIds = ids.slice(i, i + BATCH);
      const { urls } = await this.#jsonFetch(`${this.apiBaseUrl}/video/upload/parts`, {
        method: 'POST',
        body: JSON.stringify({ uploadSessionId, parts: chunkIds }),
      });

      // Upload each part in the batch sequentially to keep memory predictable
      for (const { partNumber, url } of urls.sort((a, b) => a.partNumber - b.partNumber)) {
        const { start, end } = byteRangeForPart(partNumber, partSize, size);
        const contentLength = end - start + 1;
        // Read the range into a Buffer to ensure Content-Length is sent (no chunked Transfer-Encoding)
        const buf = await this.#readFileRange(filePath, start, contentLength);
        const res = await fetchWithTimeout(
          url,
          { method: 'PUT', body: buf, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(contentLength) } },
          DEFAULT_TIMEOUT_MS
        );
        if (!res.ok) {
          const text = await safeText(res);
          throw new Error(`[UploadService] Part ${partNumber} upload failed: ${res.status} ${text}`);
        }
        const etag = res.headers.get('etag')?.replace(/\"/g, '') || '';
        if (!etag) this.logger?.warn?.(`[UploadService] Missing ETag for part ${partNumber}`);
        etags.push({ partNumber, eTag: etag });
      }
    }

    // Complete multipart
    await this.#jsonFetch(`${this.apiBaseUrl}/video/upload/complete`, {
      method: 'POST',
      body: JSON.stringify({ uploadSessionId, parts: etags }),
    });

    return { key, cdnUrl: this.#cdnUrlFor(key), status: 'uploaded' };
  }

  #cdnUrlFor(key) {
    if (!this.cdnDomain) return null;
    const domain = this.cdnDomain.replace(/^https?:\/\//, '');
    return `https://${domain}/${key}`;
  }

  async #putStream(url, stream, contentType = 'application/octet-stream') {
    const res = await fetchWithTimeout(
      url,
      { method: 'PUT', headers: { 'Content-Type': contentType }, body: stream, duplex: 'half' },
      DEFAULT_TIMEOUT_MS
    );
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`[UploadService] PUT failed: ${res.status} ${text}`);
    }
    return true;
  }

  async #putFile(url, filePath, contentType = 'application/octet-stream', contentLength) {
    // For single uploads (typically small), read into memory to set explicit Content-Length
    const buf = await fs.promises.readFile(filePath);
    const headers = { 'Content-Type': contentType };
    headers['Content-Length'] = String(contentLength ?? buf.length);
    const res = await fetchWithTimeout(url, { method: 'PUT', headers, body: buf }, DEFAULT_TIMEOUT_MS);
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`[UploadService] PUT failed: ${res.status} ${text}`);
    }
    return true;
  }

  async #readFileRange(filePath, start, length) {
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(length);
      let offset = 0;
      while (offset < length) {
        const { bytesRead } = await fh.read(buf, offset, length - offset, start + offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      return buf.subarray(0, length);
    } finally {
      await fh.close();
    }
  }

  async #jsonFetch(url, init) {
  const res = await fetchWithTimeout(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
  }, DEFAULT_TIMEOUT_MS);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new Error(`[UploadService] ${res.status} ${text || ''}`);
    return json;
  }
}

function guessContentType(ext) {
  const e = String(ext || '').toLowerCase();
  switch (e) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    default: return 'application/octet-stream';
  }
}

function byteRangeForPart(partNumber, partSize, totalSize) {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(start + partSize - 1, totalSize - 1);
  return { start, end };
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!AbortControllerRef) {
    // No AbortController available; run without timeout
    return fetch(url, options);
  }
  const ctrl = new AbortControllerRef();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
