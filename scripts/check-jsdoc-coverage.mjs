#!/usr/bin/env node
/**
 * Check JSDoc coverage across the codebase
 * Reports files and functions missing documentation
 */

import { globby } from 'globby';
import { readFile } from 'fs/promises';
import path from 'path';

const EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/public/**',
  '**/*.test.mjs',
  '**/*.spec.mjs'
];

async function checkJSDocCoverage() {
  console.log('🔍 Checking JSDoc coverage...\n');

  const files = await globby(['src/**/*.mjs'], {
    ignore: EXCLUDE_PATTERNS,
    absolute: true
  });

  let totalFiles = 0;
  let documentedFiles = 0;
  let totalFunctions = 0;
  let documentedFunctions = 0;
  let totalClasses = 0;
  let documentedClasses = 0;

  const undocumentedFiles = [];
  const poorlyDocumentedFiles = [];

  for (const file of files) {
    totalFiles++;
    const content = await readFile(file, 'utf-8');
    const relativePath = path.relative(process.cwd(), file);

    // Check for file-level JSDoc
    const hasFileDoc = /\/\*\*[\s\S]*?@file/.test(content);
    if (hasFileDoc) documentedFiles++;

    // Count functions and their documentation
    const functionMatches = content.matchAll(/(?:async\s+)?(?:export\s+)?function\s+(\w+)/g);
    const arrowFunctionMatches = content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g);
    const methodMatches = content.matchAll(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/g);
    
    const allFunctions = [
      ...Array.from(functionMatches),
      ...Array.from(arrowFunctionMatches),
      ...Array.from(methodMatches)
    ];

    const functionNames = allFunctions.map(m => m[1]).filter(name => 
      name && !name.startsWith('_') && name !== 'constructor'
    );

    const uniqueFunctions = [...new Set(functionNames)];
    totalFunctions += uniqueFunctions.length;

    // Check for JSDoc above each function
    let documentsCount = 0;
    for (const funcName of uniqueFunctions) {
      const regex = new RegExp(`/\\*\\*[\\s\\S]*?\\*/\\s*(?:async\\s+)?(?:export\\s+)?(?:function\\s+${funcName}|${funcName}\\s*[=(])`, 'g');
      if (regex.test(content)) {
        documentsCount++;
        documentedFunctions++;
      }
    }

    // Count classes and their documentation
    const classMatches = content.matchAll(/(?:export\s+)?class\s+(\w+)/g);
    const classes = Array.from(classMatches).map(m => m[1]);
    totalClasses += classes.length;

    for (const className of classes) {
      const regex = new RegExp(`/\\*\\*[\\s\\S]*?@class[\\s\\S]*?\\*/\\s*(?:export\\s+)?class\\s+${className}`, 'g');
      if (regex.test(content)) {
        documentedClasses++;
      }
    }

    // Track files with poor documentation
    if (!hasFileDoc && uniqueFunctions.length > 0) {
      undocumentedFiles.push(relativePath);
    } else if (uniqueFunctions.length > 0) {
      const coverage = (documentsCount / uniqueFunctions.length) * 100;
      if (coverage < 50) {
        poorlyDocumentedFiles.push({
          file: relativePath,
          documented: documentsCount,
          total: uniqueFunctions.length,
          coverage: coverage.toFixed(1)
        });
      }
    }
  }

  // Calculate percentages
  const fileCoverage = totalFiles > 0 ? (documentedFiles / totalFiles * 100).toFixed(1) : 0;
  const functionCoverage = totalFunctions > 0 ? (documentedFunctions / totalFunctions * 100).toFixed(1) : 0;
  const classCoverage = totalClasses > 0 ? (documentedClasses / totalClasses * 100).toFixed(1) : 0;

  // Print report
  console.log('📊 Coverage Report\n');
  console.log(`Files:     ${documentedFiles}/${totalFiles} (${fileCoverage}%)`);
  console.log(`Functions: ${documentedFunctions}/${totalFunctions} (${functionCoverage}%)`);
  console.log(`Classes:   ${documentedClasses}/${totalClasses} (${classCoverage}%)`);

  if (undocumentedFiles.length > 0) {
    console.log(`\n❌ Files without file-level JSDoc (${undocumentedFiles.length}):`);
    undocumentedFiles.slice(0, 10).forEach(file => console.log(`  - ${file}`));
    if (undocumentedFiles.length > 10) {
      console.log(`  ... and ${undocumentedFiles.length - 10} more`);
    }
  }

  if (poorlyDocumentedFiles.length > 0) {
    console.log(`\n⚠️  Files with < 50% function coverage (${poorlyDocumentedFiles.length}):`);
    poorlyDocumentedFiles.slice(0, 10).forEach(({ file, documented, total, coverage }) => {
      console.log(`  - ${file}: ${documented}/${total} (${coverage}%)`);
    });
    if (poorlyDocumentedFiles.length > 10) {
      console.log(`  ... and ${poorlyDocumentedFiles.length - 10} more`);
    }
  }

  // Determine exit code
  const overallCoverage = (documentedFiles + documentedFunctions + documentedClasses) / 
                          (totalFiles + totalFunctions + totalClasses) * 100;

  console.log(`\n📈 Overall Coverage: ${overallCoverage.toFixed(1)}%\n`);

  if (overallCoverage < 30) {
    console.log('⚠️  Documentation coverage is below 30%. Consider improving documentation.\n');
  } else if (overallCoverage < 60) {
    console.log('⚠️  Documentation coverage is moderate. Keep improving!\n');
  } else if (overallCoverage < 80) {
    console.log('✅ Good documentation coverage. Getting better!\n');
  } else {
    console.log('🎉 Excellent documentation coverage!\n');
  }

  console.log('💡 Tips:');
  console.log('  - Add @file JSDoc to all source files');
  console.log('  - Document all public functions with @param, @returns, @example');
  console.log('  - Use @context and @architecture for LLM understanding');
  console.log('  - See docs/JSDOC_STANDARDS.md for guidelines\n');
}

checkJSDocCoverage().catch(err => {
  console.error('Error checking JSDoc coverage:', err);
  process.exit(1);
});
