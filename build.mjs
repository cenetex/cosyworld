
/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function build() {
  console.log('🏗️ Starting build process...');

  try {

    // Build CSS
    await execAsync('npx tailwindcss -i ./src/tailwind.css -o ./public/css/tailwind.css --minify');

    console.log('✅ Build completed successfully');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
