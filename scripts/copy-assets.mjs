/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Script to copy static assets to the dist folder for production build
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Define source and destination directories
const srcDir = path.join(rootDir, 'src/services/web/public');
const destDir = path.join(rootDir, 'dist');

// Files and directories to copy
const assetsToCopy = [
  // CSS
  { src: 'css/tribe-styles.css', dest: 'css/tribe-styles.css' },
  // Root HTML
  { src: 'index.html', dest: 'index.html', transform: true },
  { src: 'checkout.html', dest: 'checkout.html', transform: true },
  { src: 'api-docs.html', dest: 'api-docs.html', transform: true },
  { src: 'rati.html', dest: 'rati.html', transform: false },
  { src: 'rati.js', dest: 'rati.js', transform: false },
  // Admin HTML pages
  { src: 'admin/login.html', dest: 'admin/login.html', transform: true },
  { src: 'admin/index.html', dest: 'admin/index.html', transform: true },
  { src: 'admin/guild-settings.html', dest: 'admin/guild-settings.html', transform: true },
  { src: 'admin/entity-management.html', dest: 'admin/entity-management.html', transform: true },
  { src: 'admin/secrets.html', dest: 'admin/secrets.html', transform: true },
  { src: 'admin/settings.html', dest: 'admin/settings.html', transform: true },
  // Public images
  { src: 'images/logo.png', dest: 'images/logo.png' },
  { src: 'images/default-avatar.svg', dest: 'images/default-avatar.svg' },
  { src: 'images/default-collection.svg', dest: 'images/default-collection.svg' },
];

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

function copyDirectory(srcDirectory, destDirectory) {
  ensureDirectoryExists(destDirectory);
  const entries = fs.readdirSync(srcDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDirectory, entry.name);
    const destPath = path.join(destDirectory, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      ensureDirectoryExists(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest, transform = false) {
  const srcPath = path.join(srcDir, src);
  const destPath = path.join(destDir, dest);

  ensureDirectoryExists(path.dirname(destPath));

  if (!fs.existsSync(srcPath)) {
    console.warn(`Warning: Source path does not exist: ${srcPath}`);
    return;
  }

  if (transform && (src.endsWith('.html') || src.endsWith('.htm'))) {
    let content = fs.readFileSync(srcPath, 'utf8');
  // Rewrite any script tag that references /js/*.js to /js/*.bundle.js
  content = content.replace(/(<script[^>]*src="\/js\/)([^"/]+)\.js([^>]*>)/g, '$1$2.bundle.js$3');
  // Remove type="module" from those script tags to ensure classic script execution
  content = content.replace(/<script([^>]*src="\/js\/[^"]+\.bundle\.js)[^>]*type="module"([^>]*)>/g, '<script$1$2>');
    fs.writeFileSync(destPath, content);
    console.log(`Transformed and copied: ${src} -> ${dest}`);
  } else {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied: ${src} -> ${dest}`);
  }
}

function copyAssets() {
  console.log('Starting to copy assets...');
  ensureDirectoryExists(destDir);
  ensureDirectoryExists(path.join(destDir, 'js'));

  for (const asset of assetsToCopy) {
    copyFile(asset.src, asset.dest, asset.transform);
  }

  // Copy thumbnails directory recursively if it exists
  const thumbsSrc = path.join(srcDir, 'thumbnails');
  const thumbsDest = path.join(destDir, 'thumbnails');
  if (fs.existsSync(thumbsSrc)) {
    copyDirectory(thumbsSrc, thumbsDest);
    console.log('Copied thumbnails directory');
  }

  console.log('Assets copied successfully!');
}

copyAssets();