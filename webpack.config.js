/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import path from 'path';
import webpack from 'webpack';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    mode: isProduction ? 'production' : 'development',
    target: 'web',
    entry: {
      main: './src/services/web/public/js/main.js',
      adminPanel: './src/services/web/public/js/adminPanel.js',
      avatarManagement: './src/services/web/public/js/avatar-management.js',
      styles: [
        './src/tailwind.css',
        './src/services/web/public/css/tribe-styles.css'
      ]
    },
    experiments: {
      outputModule: true
    },
    output: {
      filename: '[name].bundle.js',
      path: path.resolve(__dirname, 'dist/js'),
      publicPath: '/js/',
      module: true, 
      chunkFormat: 'array-push' // Use array-push format which is more compatible
    },
    module: {
      rules: [
        {
          test: /\.(js|mjs)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', {
                  targets: '> 0.25%, not dead',
                  useBuiltIns: 'entry',
                  corejs: 3,
                  modules: false // Preserve ES modules
                }]
              ]
            }
          }
        },
        {
          test: /\.js$/,
          include: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', {
                  targets: '> 0.25%, not dead',
                  useBuiltIns: 'entry',
                  corejs: 3,
                  modules: false // Preserve ES modules
                }]
              ]
            }
          }
        },
        {
          test: /\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
            {
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: [
                    tailwindcss,
                    autoprefixer,
                  ],
                },
              },
            },
          ],
        },
      ]
    }
,    
    resolve: {
      fallback: {
        "path": false,
        "fs": false
      }
    },
    plugins: [
      new webpack.ProvidePlugin({
        // Make require available in the browser
        process: 'process/browser',
        Buffer: ['buffer', 'Buffer']
      }),
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
        'process.env.API_URL': JSON.stringify(process.env.API_URL || '/api')
      }),
      // Extract CSS into separate files
      new MiniCssExtractPlugin({
        filename: '../css/[name].css',
      }),
      // Copy static files to the dist folder
      new CopyWebpackPlugin({
        patterns: [
          { from: './src/services/web/public', to: '../' }
        ]
      }),
    ]
  };
};