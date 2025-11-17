/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import path from 'path';
import webpack from 'webpack';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default (env, argv) => {
  const isProduction = argv.mode === 'production';

  // Normalize HTML script tags to point at webpack bundles
  const transformHtml = (content) => {
    let html = content.toString();
    // 1) Normalize relative ../js/ or js/ to absolute /js/
    html = html.replace(/(src=["'])\.\.\/js\//g, '$1/js/');
    html = html.replace(/(src=["'])js\//g, '$1/js/');
    // 2) Remove type="module" (we emit classic scripts)
    html = html.replace(/<script([^>]*?)\s+type=["']module["']([^>]*)>/g, '<script$1$2>');
    // 3) Rewrite /js/name.js -> /js/nameCamel.bundle.js (preserve query)
    html = html.replace(/(<script[^>]*\bsrc=["'])(?:\/)?js\/([^"'\?]+)\.js(\?[^"']*)?(["'][^>]*>)/g,
      (m, pre, name, query = '', post) => {
        // If the src already points to a bundle, leave it unchanged
        if (name.endsWith('.bundle')) return m;
        const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return `${pre}/js/${camel}.bundle.js${query}${post}`;
      });
    return Buffer.from(html);
  };

  return {
    mode: isProduction ? 'production' : 'development',
    target: 'web',
    entry: {
      main: './src/services/web/public/js/main.js',
      adminPanel: './src/services/web/public/js/adminPanel.js',
      avatarManagement: './src/services/web/public/js/avatar-management.js',
      entityManagement: './src/services/web/public/js/entity-management.js',
      adminLogin: './src/services/web/public/js/admin-login.js',
      adminDashboard: './src/services/web/public/js/admin-dashboard.js',
      xAccountManagement: './src/services/web/public/js/x-account-management.js',
      xGlobalPosting: './src/services/web/public/js/x-global-posting.js',
      telegramGlobalPosting: './src/services/web/public/js/telegram-global-posting.js',
      adminCollections: './src/services/web/public/js/admin-collections.js',
      adminSettings: './src/services/web/public/js/admin-settings.js',
      adminServers: './src/services/web/public/js/admin-servers.js',
      adminSecrets: './src/services/web/public/js/admin-secrets.js',
      guildSettings: './src/services/web/public/js/guild-settings.js',
      'admin/adminBootstrap': './src/services/web/public/js/admin/admin-bootstrap.js',
      tailwind: './src/tailwind.css'
    },
    output: {
      filename: '[name].bundle.js',
      path: path.resolve(__dirname, 'dist/js'),
      publicPath: '/js/'
    },
    module: {
      rules: [
        {
          test: /\.(js|mjs)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader'
          }
        },
        {
          test: /\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
            'postcss-loader'
          ]
        }
      ]
    },
    resolve: {
      fallback: {
        path: false,
        fs: false
      }
    },
    plugins: [
      new webpack.ProvidePlugin({
        process: 'process/browser',
        Buffer: ['buffer', 'Buffer']
      }),
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
        'process.env.API_URL': JSON.stringify(process.env.API_URL || '/api')
      }),
      new MiniCssExtractPlugin({ filename: '../css/[name].css' }),
      new CopyWebpackPlugin({
        patterns: [
          // Root HTML
          { from: path.resolve(__dirname, 'src/services/web/public/index.html'), to: path.resolve(__dirname, 'dist/index.html') },
          { from: path.resolve(__dirname, 'src/services/web/public/app.html'), to: path.resolve(__dirname, 'dist/app.html'), transform: transformHtml },
          { from: path.resolve(__dirname, 'src/services/web/public/checkout.html'), to: path.resolve(__dirname, 'dist/checkout.html'), transform: transformHtml },
          { from: path.resolve(__dirname, 'src/services/web/public/api-docs.html'), to: path.resolve(__dirname, 'dist/api-docs.html'), transform: transformHtml },
          { from: path.resolve(__dirname, 'src/services/web/public/link.html'), to: path.resolve(__dirname, 'dist/link.html'), transform: transformHtml },
          // Admin HTML
          { from: path.resolve(__dirname, 'src/services/web/public/admin/*.html'), to: path.resolve(__dirname, 'dist/admin/[name][ext]'), transform: transformHtml },
          // Other static files
          { from: path.resolve(__dirname, 'src/services/web/public/rati.html'), to: path.resolve(__dirname, 'dist/rati.html') },
          { from: path.resolve(__dirname, 'src/services/web/public/rati.js'), to: path.resolve(__dirname, 'dist/rati.js') },
          { from: path.resolve(__dirname, 'src/services/web/public/css/tribe-styles.css'), to: path.resolve(__dirname, 'dist/css/tribe-styles.css') },
          { from: path.resolve(__dirname, 'src/services/web/public/css/admin-common.css'), to: path.resolve(__dirname, 'dist/css/admin-common.css') },
          { from: path.resolve(__dirname, 'src/services/web/public/images'), to: path.resolve(__dirname, 'dist/images') },
          { from: path.resolve(__dirname, 'src/services/web/public/thumbnails'), to: path.resolve(__dirname, 'dist/thumbnails'), noErrorOnMissing: true }
        ]
      })
    ]
  };
};