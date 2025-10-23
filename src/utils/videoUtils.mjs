/**
 * @fileoverview Video processing utilities for concatenating and manipulating videos
 * @module src/utils/videoUtils
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

/**
 * Check if ffmpeg is installed
 * @returns {Promise<boolean>} True if ffmpeg is available
 */
export async function checkFfmpegAvailable() {
  try {
    await execAsync('ffmpeg -version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a video from URL to local file
 * @param {string} url - Video URL
 * @param {string} outputPath - Local file path
 * @returns {Promise<void>}
 */
async function downloadVideo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }
  
  const fileStream = fs.createWriteStream(outputPath);
  await pipeline(response.body, fileStream);
}

/**
 * Concatenate multiple videos into a single video using ffmpeg
 * @param {string[]} videoUrls - Array of video URLs to concatenate
 * @param {Object} s3Service - S3 service for uploading result
 * @param {Object} options - Options
 * @param {string} options.prefix - S3 prefix for upload
 * @returns {Promise<string>} URL of the concatenated video
 */
export async function concatenateVideos(videoUrls, s3Service, options = {}) {
  const { prefix = 'concatenated-videos' } = options;
  
  // Check ffmpeg availability
  const ffmpegAvailable = await checkFfmpegAvailable();
  if (!ffmpegAvailable) {
    throw new Error('ffmpeg is not installed or not available in PATH');
  }

  // Create temporary directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-concat-'));
  
  try {
    console.log(`[VideoUtils] Downloading ${videoUrls.length} videos to ${tempDir}`);
    
    // Download all videos
    const downloadedFiles = [];
    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i];
      const filename = `video-${i.toString().padStart(3, '0')}.mp4`;
      const filepath = path.join(tempDir, filename);
      
      await downloadVideo(url, filepath);
      downloadedFiles.push(filepath);
      console.log(`[VideoUtils] Downloaded ${i + 1}/${videoUrls.length}: ${filename}`);
    }

    // Create concat file for ffmpeg
    const concatFilePath = path.join(tempDir, 'concat-list.txt');
    const concatContent = downloadedFiles.map(f => `file '${f}'`).join('\n');
    fs.writeFileSync(concatFilePath, concatContent);

    // Output file
    const outputPath = path.join(tempDir, 'concatenated.mp4');

    // Run ffmpeg concatenation
    // Using concat demuxer for fastest concatenation (no re-encoding)
    const ffmpegCommand = `ffmpeg -f concat -safe 0 -i "${concatFilePath}" -c copy "${outputPath}"`;
    console.log(`[VideoUtils] Running ffmpeg: ${ffmpegCommand}`);
    
    const { stderr } = await execAsync(ffmpegCommand);
    if (stderr) {
      console.log(`[VideoUtils] ffmpeg stderr:`, stderr);
    }

    // Check if output file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error('ffmpeg did not produce output file');
    }

    const stats = fs.statSync(outputPath);
    console.log(`[VideoUtils] Concatenated video size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Upload to S3
    console.log(`[VideoUtils] Uploading concatenated video to S3 with prefix: ${prefix}`);
    const videoBuffer = fs.readFileSync(outputPath);
    const timestamp = Date.now();
    const s3Key = `${prefix}/concatenated-${timestamp}.mp4`;
    
    const uploadedUrl = await s3Service.uploadFile(videoBuffer, s3Key, 'video/mp4');
    console.log(`[VideoUtils] Uploaded concatenated video: ${uploadedUrl}`);

    return uploadedUrl;

  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`[VideoUtils] Cleaned up temp directory: ${tempDir}`);
    } catch (cleanupError) {
      console.error(`[VideoUtils] Failed to cleanup temp directory:`, cleanupError);
    }
  }
}
