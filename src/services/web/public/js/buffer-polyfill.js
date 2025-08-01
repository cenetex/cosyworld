/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */


// Import buffer from skypack (browser-compatible CDN)
import { Buffer } from 'https://cdn.skypack.dev/buffer';

// Make Buffer and other Node.js globals available
window.Buffer = Buffer;
window.global = window;
window.process = { env: {} };
