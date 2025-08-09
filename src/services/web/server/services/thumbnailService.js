/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import sharp from 'sharp';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

const THUMB_SIZE = 128;

function resolveThumbDir() {
  // In production, serve from dist/thumbnails. In dev, from src/services/web/public/thumbnails.
  const isProd = process.env.NODE_ENV === 'production';
  return isProd
    ? path.resolve(process.cwd(), 'dist', 'thumbnails')
    : path.resolve(process.cwd(), 'src', 'services', 'web', 'public', 'thumbnails');
}

class ThumbnailService {
  getThumbnailDir() {
    return resolveThumbDir();
  }

  async ensureThumbnailDir() {
    try {
      await fs.access(this.getThumbnailDir());
    } catch {
      await fs.mkdir(this.getThumbnailDir(), { recursive: true });
    }
  }

  async generateThumbnail(imageUrl) {
    await this.ensureThumbnailDir();

    if (!imageUrl) {
      return;
    }
    const hash = crypto.createHash('md5').update(imageUrl).digest('hex');
    const thumbnailPath = path.join(this.getThumbnailDir(), `${hash}.webp`);

    try {
      // Check if thumbnail already exists
      await fs.access(thumbnailPath);
      return `/thumbnails/${hash}.webp`;
    } catch {
      // Generate thumbnail from source (supports http(s), data URLs, and local files like /images/...)
      let inputBuffer;
      if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image/')) {
        const base64 = imageUrl.split(',')[1];
        inputBuffer = Buffer.from(base64, 'base64');
      } else if (typeof imageUrl === 'string' && imageUrl.startsWith('/images/')) {
        const localPath = path.resolve(process.cwd(), 'images', imageUrl.replace('/images/', ''));
        try {
          inputBuffer = await fs.readFile(localPath);
        } catch (e) {
          throw new Error(`Local image not found: ${localPath}`);
        }
      } else if (typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        const arrayBuf = await response.arrayBuffer();
        inputBuffer = Buffer.from(arrayBuf);
      } else {
        // Unsupported URL format
        throw new Error(`Unsupported image URL: ${imageUrl}`);
      }

      await sharp(inputBuffer)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(thumbnailPath);
      return `/thumbnails/${hash}.webp`;
    }
  }
}

export const thumbnailService = new ThumbnailService();