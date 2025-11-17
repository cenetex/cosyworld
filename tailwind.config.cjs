/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/services/web/public/**/*.{html,js}",
    "./src/**/*.{html,js,jsx,ts,tsx}",
    "./docs/**/*.{html,md}"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
