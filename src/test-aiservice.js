/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import { container } from './container.mjs';
import { configDotenv } from 'dotenv';
configDotenv({ path: './.env' });
try {
  container.resolve('aiService')
} catch (err) {
  console.error(err.path)  // this will also show the exact cycle
}