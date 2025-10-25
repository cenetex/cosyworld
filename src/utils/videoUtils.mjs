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
import eventBus from './eventBus.mjs';

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
 * @param {string} options.source - Source of video (e.g., 'story-chapter', 'story-episode')
 * @param {Object} options.context - Additional context for social media posting
 * @param {string} options.context.arcTitle - Story arc title
 * @param {number} options.context.chapterNumber - Chapter number
 * @param {string} options.context.theme - Story theme
 * @param {string} options.context.emotionalTone - Story emotional tone
 * @param {boolean} options.skipEventEmit - Skip emitting MEDIA.VIDEO.GENERATED event
 * @returns {Promise<string>} URL of the concatenated video
 */
export async function concatenateVideos(videoUrls, s3Service, options = {}) {
  const { 
    prefix = 'concatenated-videos',
    source = 'video-concatenation',
    context = {},
    skipEventEmit = false
  } = options;
  
  // Check ffmpeg availability
  const ffmpegAvailable = await checkFfmpegAvailable();
  if (!ffmpegAvailable) {
    throw new Error('ffmpeg is not installed or not available in PATH');
  }

  // Create temporary directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-concat-'));
  
  try {
    console.log(`[VideoUtils] Downloading ${videoUrls.length} videos to ${tempDir}`);
    console.log(`[VideoUtils] Video URLs:`, videoUrls);
    
    // Download all videos
    const downloadedFiles = [];
    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i];
      const filename = `video-${i.toString().padStart(3, '0')}.mp4`;
      const filepath = path.join(tempDir, filename);
      
      console.log(`[VideoUtils] Downloading ${i + 1}/${videoUrls.length} from: ${url}`);
      try {
        await downloadVideo(url, filepath);
        downloadedFiles.push(filepath);
        console.log(`[VideoUtils] Downloaded ${i + 1}/${videoUrls.length}: ${filename} (${fs.statSync(filepath).size} bytes)`);
      } catch (downloadError) {
        console.error(`[VideoUtils] Failed to download video ${i + 1}:`, downloadError);
        throw new Error(`Failed to download video ${i + 1}: ${downloadError.message}`);
      }
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
    console.log(`[VideoUtils] Running ffmpeg command`);
    console.log(`[VideoUtils] Concat file contents:\n${concatContent}`);
    
    try {
      const { stderr } = await execAsync(ffmpegCommand);
      if (stderr) {
        console.log(`[VideoUtils] ffmpeg stderr:`, stderr);
      }
    } catch (ffmpegError) {
      console.error(`[VideoUtils] ffmpeg command failed:`, ffmpegError);
      throw new Error(`ffmpeg concatenation failed: ${ffmpegError.message}`);
    }

    // Check if output file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error('ffmpeg did not produce output file');
    }

    const stats = fs.statSync(outputPath);
    console.log(`[VideoUtils] Concatenated video size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Upload to S3 using uploadImageToS3 (works for videos too)
    console.log(`[VideoUtils] Uploading concatenated video to S3 with prefix: ${prefix}`);
    
    try {
      const uploadedUrl = await s3Service.uploadImageToS3(outputPath, {
        source,
        purpose: 'chapter-video',
        skipEventEmit: true // We'll emit our own event with better context
      });
      
      if (!uploadedUrl) {
        throw new Error('S3 upload returned null - check S3Service configuration');
      }
      
      console.log(`[VideoUtils] Uploaded concatenated video: ${uploadedUrl}`);
      
      // Emit MEDIA.VIDEO.GENERATED event for social media posting
      if (!skipEventEmit) {
        const videoType = source.includes('episode') ? 'episode' : 'chapter';
        const chapterText = context.chapterNumber ? ` Chapter ${context.chapterNumber}` : '';
        const themeText = context.theme ? ` [${context.theme}]` : '';
        const toneText = context.emotionalTone ? ` - ${context.emotionalTone}` : '';
        
        const caption = context.arcTitle 
          ? `🎬 ${context.arcTitle}${chapterText}${themeText}${toneText}`
          : `🎬 Story ${videoType} video generated`;
        
        console.log(`[VideoUtils] Emitting MEDIA.VIDEO.GENERATED event:`, {
          videoUrl: uploadedUrl,
          source,
          caption
        });
        
        eventBus.emit('MEDIA.VIDEO.GENERATED', {
          type: 'video',
          source,
          videoUrl: uploadedUrl,
          purpose: videoType === 'episode' ? 'story-episode' : 'story-chapter',
          context: caption,
          prompt: caption,
          metadata: {
            arcTitle: context.arcTitle,
            chapterNumber: context.chapterNumber,
            theme: context.theme,
            emotionalTone: context.emotionalTone,
            clipCount: videoUrls.length,
            videoType
          },
          createdAt: new Date()
        });
      }
      
      return uploadedUrl;
    } catch (uploadError) {
      console.error(`[VideoUtils] S3 upload failed:`, uploadError);
      throw new Error(`Failed to upload concatenated video to S3: ${uploadError.message}`);
    }

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
