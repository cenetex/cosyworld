#!/usr/bin/env node
/**
 * Script to add copyright headers to all source files
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);

// Copyright header templates for different file types
const copyrightHeaders = {
  js: `/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

`,
  css: `/*
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

`,
  html: `<!--
  Copyright (c) 2019-2024 Cenetex Inc.
  Licensed under the MIT License.
-->

`
};

// File extensions and their corresponding header types
const fileTypeMap = {
  '.js': 'js',
  '.mjs': 'js',
  '.ts': 'js',
  '.jsx': 'js',
  '.tsx': 'js',
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.html': 'html'
};

// Files and directories to skip
const skipPatterns = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'LICENSE',
  'README',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  '.gitignore',
  '.env',
  'webpack-stats.txt'
];

function shouldSkipFile(filePath) {
  const relativePath = path.relative(rootDir, filePath);
  return skipPatterns.some(pattern => 
    relativePath.includes(pattern) || 
    relativePath.startsWith('.') ||
    path.basename(filePath).startsWith('.')
  );
}

function hasExistingCopyright(content) {
  const firstLines = content.split('\n').slice(0, 10).join('\n').toLowerCase();
  return firstLines.includes('copyright') || 
         firstLines.includes('cenetex') || 
         firstLines.includes('mit license');
}

function addCopyrightHeader(filePath, content, headerType) {
  const header = copyrightHeaders[headerType];
  
  // Check if file already has copyright
  if (hasExistingCopyright(content)) {
    console.log(`⚠️  Skipping ${path.relative(rootDir, filePath)} - already has copyright`);
    return content;
  }

  // For JS/TS files, check if there's already a shebang line
  if (headerType === 'js' && content.startsWith('#!')) {
    const lines = content.split('\n');
    const shebang = lines[0];
    const rest = lines.slice(1).join('\n');
    return shebang + '\n' + header + rest;
  }

  return header + content;
}

function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const headerType = fileTypeMap[ext];
  
  if (!headerType) {
    return; // Skip unsupported file types
  }

  if (shouldSkipFile(filePath)) {
    return;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const newContent = addCopyrightHeader(filePath, content, headerType);
    
    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      console.log(`✅ Added copyright header to ${path.relative(rootDir, filePath)}`);
    }
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
  }
}

function walkDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (!shouldSkipFile(fullPath)) {
        walkDirectory(fullPath);
      }
    } else if (stat.isFile()) {
      processFile(fullPath);
    }
  }
}

function main() {
  console.log('🚀 Adding copyright headers to source files...\n');
  
  const startTime = Date.now();
  walkDirectory(rootDir);
  const endTime = Date.now();
  
  console.log(`\n✨ Completed in ${endTime - startTime}ms`);
}

main();
