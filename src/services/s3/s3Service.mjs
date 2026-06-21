/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { request } from 'https';
import { request as httpRequest } from 'http';
import { UploadService } from '../media/uploadService.mjs';
import eventBus from '../../utils/eventBus.mjs';

const DEFAULT_LOCAL_MEDIA_DIR = process.env.NODE_ENV === 'production' ? '/data/media' : path.join(process.cwd(), 'data', 'media');
const DEFAULT_PUBLIC_BASE_URL = process.env.PUBLIC_URL || process.env.BASE_URL || 'http://localhost:3000';

export class S3Service {
  constructor({ logger }) {
    this.logger = logger;

    // Load environment variables
    this.S3_API_KEY = process.env.S3_API_KEY;
    this.S3_API_ENDPOINT = process.env.S3_API_ENDPOINT;
    this.CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;
    this.USE_UPLOAD_API = !!process.env.UPLOAD_API_BASE_URL;
    this.STORAGE_BACKEND = (process.env.FILE_STORAGE_BACKEND || process.env.STORAGE_BACKEND || '').toLowerCase();
    this.localMediaDir = process.env.LOCAL_MEDIA_DIR || DEFAULT_LOCAL_MEDIA_DIR;
    this.publicBaseUrl = (process.env.PUBLIC_MEDIA_BASE_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/$/, '');
    this.configured = false;

    if (this.STORAGE_BACKEND === 'local') {
      this.configured = true;
      this.logger?.info?.(`[S3Service] Using self-contained local media storage at ${this.localMediaDir}`);
    } else if (this.USE_UPLOAD_API) {
      // Initialize new upload flow if enabled
      this.uploadService = new UploadService({
        logger: this.logger,
        apiBaseUrl: process.env.UPLOAD_API_BASE_URL,
        cdnDomain: this.CLOUDFRONT_DOMAIN,
      });
      this.configured = true;
      // Only CDN is required for returning URLs; S3_API_* not needed
      if (!this.CLOUDFRONT_DOMAIN) {
        this.logger?.warn?.('[S3Service] CLOUDFRONT_DOMAIN missing; cdnUrl will be null (UploadService still works)');
      }
    } else if (this.S3_API_KEY && this.S3_API_ENDPOINT && this.CLOUDFRONT_DOMAIN) {
      // Legacy path configured
      this.configured = true;
    } else {
      this.STORAGE_BACKEND = 'local';
      this.configured = true;
      this.logger?.info?.(`[S3Service] Using self-contained local media storage at ${this.localMediaDir}`);
    }
  }

  /**
   * Upload an image to S3 and return its public CDN URL
   * @param {string} filePath - Local file path
   * @param {Object} options - Upload options
   * @param {boolean} options.skipEventEmit - Skip emitting MEDIA events (for intermediate/keyframe images)
   * @returns {Promise<string|null>} CDN URL or null if upload failed
   */
  async uploadImageToS3(filePath, options = {}) {
    // Check if service is configured
    if (!this.configured) {
      this.logger?.warn?.('[S3Service] Upload attempted but service not configured. Please complete setup wizard.');
      return null;
    }

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        this.logger.error(`Error: File not found at path "${filePath}"`);
        return;
      }

      const imageType = path.extname(filePath).substring(1).toLowerCase(); // e.g., 'png', 'jpg'
      const validImageTypes = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mp3', 'wav', 'm4a', 'ogg'];
      if (!validImageTypes.includes(imageType)) {
        this.logger.error(`Error: Unsupported media type ".${imageType}". Supported types: ${validImageTypes.join(', ')}`);
        return;
      }

      if (this.STORAGE_BACKEND === 'local') {
        const finalUrl = await this.#uploadLocalFile(filePath, { extension: imageType });
        this.#emitMediaEvent(finalUrl, options);
        return finalUrl;
      }

      // New upload API path (presigned direct-to-S3)
      if (this.USE_UPLOAD_API && this.uploadService) {
        const ct = imageType === 'mp4'
          ? 'video/mp4'
          : `image/${imageType === 'jpg' ? 'jpeg' : imageType}`;
        const { key, cdnUrl, status } = await this.uploadService.uploadFile(filePath, { contentType: ct });
        const finalUrl = cdnUrl || (this.CLOUDFRONT_DOMAIN ? `${this.CLOUDFRONT_DOMAIN.replace(/\/$/, '')}/${key}` : null);
        if (!finalUrl) {
          this.logger.error('[S3Service] Upload succeeded but no CDN domain configured to build URL');
          return null;
        }
        this.logger.info(`Upload Successful via UploadService! status=${status}`);
        this.logger.info(`Image URL: ${finalUrl}`);
        
        this.#emitMediaEvent(finalUrl, options);
        
        return finalUrl;
      }

      // Legacy path: POST base64 payload to S3_API_ENDPOINT
      const imageBuffer = fs.readFileSync(filePath);
      const imageBase64 = imageBuffer.toString('base64');

      // Prepare the request payload
      const payload = JSON.stringify({
        image: imageBase64,
        imageType: imageType,
      });

  // Send POST request to upload the image (legacy)
      const { protocol, hostname, pathname } = new URL(this.S3_API_ENDPOINT);
      const httpModule = protocol === 'https:' ? request : httpRequest;

      const requestOptions = {
        hostname,
        path: pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-api-key': this.S3_API_KEY,
        },
      };

      return new Promise((resolve, reject) => {
        const req = httpModule(requestOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const result = JSON.parse(data);
                const responseData = result.body ? JSON.parse(result.body) : result;
          
                if (!responseData || !responseData.url) {
                  this.logger.error(`Invalid S3 response format - missing URL. Response data: ${JSON.stringify(result)}`);
                  reject(new Error('Invalid S3 response - missing URL'));
                  return;
                }
          
                this.logger.info('Upload Successful (legacy)!');
                this.logger.info(`Image URL: ${responseData.url}`);
                resolve(responseData.url);
              } catch (error) {
                this.logger.error(`Failed to parse S3 response: ${error.message}`);
                this.logger.error(`Raw response data: ${data}`);
                reject(new Error(`Failed to parse S3 response: ${error.message}`));
              }
            } else {
              this.logger.error(`Unexpected response status: ${res.statusCode}. Response: ${data}`);
              reject(new Error(`Upload failed with status: ${res.statusCode}`));
            }
          });
        });

        req.on('error', (error) => {
          this.logger.error('Error uploading image:', error.message);
          reject(error);
        });

        req.write(payload);
        req.end();
      });
    } catch (error) {
      this.logger.error('Error:', error.message);
      throw error;
    }
  }

  async downloadImage(imageUrl, headers = {}, redirectCount = 0) {
    const MAX_REDIRECTS = 5;
    try {
      const localPath = this.#localPathForUrl(imageUrl);
      if (localPath) {
        const buffer = await fsp.readFile(localPath);
        this.logger?.info?.(`Media loaded successfully from local storage "${imageUrl}"`);
        return buffer;
      }

      const { protocol, hostname, pathname, search } = new URL(imageUrl);
      const httpModule = protocol === 'https:' ? request : httpRequest;
      const requestOptions = {
        hostname,
        path: pathname + (search || ''),
        method: 'GET',
        headers: headers || {},
      };

      return new Promise((resolve, reject) => {
        const req = httpModule(requestOptions, (res) => {
          // Handle redirects
          if ([301, 302, 307, 308].includes(res.statusCode)) {
            const location = res.headers.location;
            if (location && redirectCount < MAX_REDIRECTS) {
              this.logger?.warn(`Redirect (${res.statusCode}) to: ${location}`);
              // Recursively follow the redirect
              resolve(this.downloadImage(location, headers, redirectCount + 1));
              return;
            } else {
              this.logger?.error(`Too many redirects or missing Location header.`);
              reject(new Error('Too many redirects or missing Location header.'));
              return;
            }
          }
          if (res.statusCode === 200) {
            const data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => {
              const buffer = Buffer.concat(data);
              this.logger?.info(`Image downloaded successfully from "${imageUrl}"`);
              resolve(buffer);
            });
          } else {
            this.logger?.error(`Failed to download image. Status code: ${res.statusCode}`);
            reject(new Error(`Failed to download image with status: ${res.statusCode}`));
          }
        });

        req.on('error', (error) => {
          this.logger?.error('Error downloading image:', error.message);
          reject(error);
        });

        req.end();
      });
    } catch (error) {
      this.logger?.error('Error:', error.message);
      throw error;
    }
  }

  /**
   * Convenience alias for uploadImageToS3 with optional purpose metadata
   * @param {string} filePath - Local file path
   * @param {Object} options - Upload options
   * @param {string} options.purpose - Purpose of the image: 'keyframe', 'thumbnail', 'general', 'avatar'
   * @param {string} options.source - Source of the image
   * @param {boolean} options.skipEventEmit - Skip emitting MEDIA events
   * @returns {Promise<string|null>} CDN URL or null if upload failed
   */
  async uploadImage(filePath, options = {}) {
    return this.uploadImageToS3(filePath, options);
  }

  async uploadBuffer(buffer, filename = 'media.bin', options = {}) {
    if (!this.configured) {
      this.logger?.warn?.('[S3Service] Buffer upload attempted but service not configured.');
      return null;
    }

    if (this.STORAGE_BACKEND === 'local') {
      const extension = path.extname(filename).replace(/^\./, '') || extensionForContentType(options.contentType);
      const finalUrl = await this.#uploadLocalBuffer(Buffer.from(buffer), { filename, extension });
      this.#emitMediaEvent(finalUrl, options);
      return finalUrl;
    }

    const tempDir = path.join(process.cwd(), 'data', 'tmp');
    await fsp.mkdir(tempDir, { recursive: true });
    const safeName = sanitizeFilename(filename);
    const tempPath = path.join(tempDir, `${Date.now()}-${safeName}`);
    try {
      await fsp.writeFile(tempPath, buffer);
      return await this.uploadImageToS3(tempPath, options);
    } finally {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  /**
   * Health check for S3Service
   * Returns success even if not configured (to allow wizard to run)
   */
  async ping() {
    if (!this.configured) {
      this.logger?.warn?.('[S3Service] Ping: Service not configured (optional service)');
      return { ok: true, configured: false, message: 'S3Service not configured - optional service' };
    }
    return { ok: true, configured: true, message: 'S3Service ready' };
  }

  async #uploadLocalFile(filePath, { extension = null } = {}) {
    const ext = extension || path.extname(filePath).replace(/^\./, '') || 'bin';
    const target = await this.#localTarget(ext);
    await fsp.copyFile(filePath, target.filePath);
    this.logger?.info?.(`[S3Service] Stored media locally: ${target.url}`);
    return target.url;
  }

  async #uploadLocalBuffer(buffer, { filename = 'media.bin', extension = 'bin' } = {}) {
    const ext = extension || path.extname(filename).replace(/^\./, '') || 'bin';
    const target = await this.#localTarget(ext);
    await fsp.writeFile(target.filePath, buffer);
    this.logger?.info?.(`[S3Service] Stored media locally: ${target.url}`);
    return target.url;
  }

  async #localTarget(extension) {
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const relativeDir = path.join(yyyy, mm, dd);
    const mediaDir = path.join(this.localMediaDir, relativeDir);
    await fsp.mkdir(mediaDir, { recursive: true });

    const cleanExt = sanitizeExtension(extension);
    const filename = `${Date.now()}-${cryptoRandomId()}.${cleanExt}`;
    const relativePath = path.posix.join(yyyy, mm, dd, filename);
    const filePath = path.join(mediaDir, filename);
    return {
      filePath,
      url: `${this.publicBaseUrl}/media/${relativePath}`
    };
  }

  #localPathForUrl(mediaUrl) {
    try {
      const parsed = new URL(mediaUrl, this.publicBaseUrl);
      if (!parsed.pathname.startsWith('/media/')) return null;
      const relative = decodeURIComponent(parsed.pathname.replace(/^\/media\//, ''));
      const localPath = path.resolve(this.localMediaDir, relative);
      const root = path.resolve(this.localMediaDir);
      if (!localPath.startsWith(root + path.sep) && localPath !== root) {
        return null;
      }
      return localPath;
    } catch {
      return null;
    }
  }

  #emitMediaEvent(finalUrl, options = {}) {
    if (!finalUrl || options.skipEventEmit) return;
    try {
      const mediaType = mediaKindForUrl(finalUrl);
      if (mediaType === 'audio') return;
      eventBus.emit(mediaType === 'video' ? 'MEDIA.VIDEO.GENERATED' : 'MEDIA.IMAGE.GENERATED', {
        type: mediaType,
        source: options.source || this.STORAGE_BACKEND || 's3Service',
        purpose: options.purpose || 'general',
        imageUrl: mediaType === 'image' ? finalUrl : undefined,
        videoUrl: mediaType === 'video' ? finalUrl : undefined,
        audioUrl: mediaType === 'audio' ? finalUrl : undefined,
        prompt: options.prompt || null,
        context: options.context || null,
        locationName: options.locationName || null,
        locationDescription: options.locationDescription || null,
        avatarName: options.avatarName || null,
        avatarId: options.avatarId || null,
        avatarEmoji: options.avatarEmoji || null,
        guildId: options.guildId || null,
        createdAt: new Date()
      });
    } catch (e) {
      this.logger?.warn?.('[S3Service] emit MEDIA event failed: ' + e.message);
    }
  }
}

function sanitizeExtension(extension) {
  return String(extension || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
}

function sanitizeFilename(filename) {
  return path.basename(String(filename || 'media.bin')).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function cryptoRandomId() {
  return crypto.randomBytes(6).toString('hex');
}

function extensionForContentType(contentType = '') {
  const ct = String(contentType).toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('ogg')) return 'ogg';
  return 'bin';
}

function mediaKindForUrl(url) {
  const pathname = new URL(url, DEFAULT_PUBLIC_BASE_URL).pathname.toLowerCase();
  if (/\.(mp4|webm|mov)$/.test(pathname)) return 'video';
  if (/\.(mp3|wav|m4a|ogg)$/.test(pathname)) return 'audio';
  return 'image';
}
