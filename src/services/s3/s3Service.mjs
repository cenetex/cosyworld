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

    // Initialize new upload flow if enabled
    if (this.USE_UPLOAD_API) {
      this.uploadService = new UploadService({
        logger: this.logger,
        apiBaseUrl: process.env.UPLOAD_API_BASE_URL,
        cdnDomain: this.CLOUDFRONT_DOMAIN,
      });
      // Only CDN is required for returning URLs; S3_API_* not needed
      if (!this.CLOUDFRONT_DOMAIN) {
        this.logger?.warn?.('[S3Service] CLOUDFRONT_DOMAIN missing; cdnUrl will be null (UploadService still works)');
      }
    } else {
      // Legacy path requires these
      if (!this.S3_API_KEY || !this.S3_API_ENDPOINT || !this.CLOUDFRONT_DOMAIN) {
        throw new Error('Missing one or more required environment variables (S3_API_KEY, S3_API_ENDPOINT, CLOUDFRONT_DOMAIN)');
      }
    }
  }

  async uploadImage(filePath) {
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
        try {
          // Emit media event for downstream global poster (type inferred from extension)
          const isVideo = /\.mp4$/i.test(finalUrl);
          eventBus.emit(isVideo ? 'MEDIA.VIDEO.GENERATED' : 'MEDIA.IMAGE.GENERATED', {
            type: isVideo ? 'video' : 'image',
            source: 'uploadService',
            imageUrl: !isVideo ? finalUrl : undefined,
            videoUrl: isVideo ? finalUrl : undefined,
            prompt: null,
            createdAt: new Date()
          });
        } catch (e) { this.logger?.warn?.('[S3Service] emit MEDIA event failed: ' + e.message); }
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

      const options = {
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
        const req = httpModule(options, (res) => {
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
      const options = {
        hostname,
        path: pathname + (search || ''),
        method: 'GET',
        headers: headers || {},
      };

      return new Promise((resolve, reject) => {
        const req = httpModule(options, (res) => {
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
}
