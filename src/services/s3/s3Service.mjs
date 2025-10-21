/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import fs from 'fs';
import path from 'path';
import { request } from 'https';
import { request as httpRequest } from 'http';
import { UploadService } from '../media/uploadService.mjs';
import eventBus from '../../utils/eventBus.mjs';

export class S3Service {
  constructor({ logger }) {
    this.logger = logger;

    // Load environment variables
    this.S3_API_KEY = process.env.S3_API_KEY;
    this.S3_API_ENDPOINT = process.env.S3_API_ENDPOINT;
    this.CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;
    this.USE_UPLOAD_API = !!process.env.UPLOAD_API_BASE_URL;
    this.configured = false;

    // Initialize new upload flow if enabled
    if (this.USE_UPLOAD_API) {
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
      // Not configured - warn but don't throw
      // This allows the app to start and run the configuration wizard
      this.logger?.warn?.('[S3Service] ⚠️  Not configured. S3 uploads will not work until configuration is complete.');
      this.logger?.warn?.('[S3Service] Missing: S3_API_KEY, S3_API_ENDPOINT, or CLOUDFRONT_DOMAIN');
      this.logger?.warn?.('[S3Service] Please complete the setup wizard to enable S3 functionality.');
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
      const validImageTypes = ['png', 'jpg', 'jpeg', 'gif', 'mp4'];
      if (!validImageTypes.includes(imageType)) {
        this.logger.error(`Error: Unsupported image type ".${imageType}". Supported types: ${validImageTypes.join(', ')}`);
        return;
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
        
        // Emit media event for downstream global poster (unless suppressed for keyframes)
        if (!options.skipEventEmit) {
          try {
            const isVideo = /\.mp4$/i.test(finalUrl);
            eventBus.emit(isVideo ? 'MEDIA.VIDEO.GENERATED' : 'MEDIA.IMAGE.GENERATED', {
              type: isVideo ? 'video' : 'image',
              source: options.source || 'uploadService',
              purpose: options.purpose || 'general', // 'keyframe', 'thumbnail', 'general', 'avatar'
              imageUrl: !isVideo ? finalUrl : undefined,
              videoUrl: isVideo ? finalUrl : undefined,
              prompt: null,
              createdAt: new Date()
            });
          } catch (e) { this.logger?.warn?.('[S3Service] emit MEDIA event failed: ' + e.message); }
        }
        
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
}
