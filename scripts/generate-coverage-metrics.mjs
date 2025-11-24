#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const coverageDir = path.join(repoRoot, 'coverage');
const summaryPath = path.join(coverageDir, 'coverage-summary.json');
const outputPath = path.join(repoRoot, 'docs', 'analysis', 'coverage-metrics.md');

const formatPercent = (value) => `${value.toFixed(2)}%`;

function runVitestCoverage() {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vitest', 'run', '--coverage'], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        FORCE_COLOR: process.env.FORCE_COLOR || '1'
      }
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`vitest exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

function buildFileEntries(summary) {
  return Object.entries(summary)
    .filter(([key]) => key !== 'total')
    .map(([filePath, stats]) => {
      const relativePath = filePath.startsWith('/') || filePath.startsWith('\\')
        ? path.relative(repoRoot, filePath)
        : filePath;
      const normalized = relativePath.replace(/\\/g, '/');
      if (!normalized.startsWith('src/')) {
        return null;
      }

      const statements = stats.statements || { total: 0, covered: 0, pct: 0 };
      const functions = stats.functions || { pct: 0 };
      const branches = stats.branches || { pct: 0 };
      const lines = stats.lines || { pct: 0 };
      return {
        file: normalized,
        statementsPct: statements.pct || 0,
        statementsTotal: statements.total || 0,
        missingStatements: Math.max(0, (statements.total || 0) - (statements.covered || 0)),
        functionsPct: functions.pct || 0,
        branchesPct: branches.pct || 0,
        linesPct: lines.pct || 0,
      };
    })
    .filter(Boolean)
    .filter((entry) => entry.statementsTotal > 0);
}

function buildTable(rows, headers) {
  if (!rows.length) {
    return '| _No data available_ |\n| --- |\n';
  }

  const headerLine = `| ${headers.join(' | ')} |`;
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((cols) => `| ${cols.join(' | ')} |`);
  return [headerLine, sepLine, ...rowLines].join('\n');
}

async function writeReport(totalStats, fileEntries) {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const metrics = [
    ['Statements', totalStats.statements],
    ['Lines', totalStats.lines],
    ['Functions', totalStats.functions],
    ['Branches', totalStats.branches],
  ];

  const overallRows = metrics.map(([label, bucket]) => {
    const covered = bucket?.covered ?? 0;
    const total = bucket?.total ?? 0;
    const pct = bucket?.pct ?? 0;
    return [label, `${covered}`, `${total}`, formatPercent(pct)];
  });

  const worstCovered = [...fileEntries]
    .sort((a, b) => a.statementsPct - b.statementsPct)
    .slice(0, 5)
    .map((entry) => [
      entry.file,
      formatPercent(entry.statementsPct),
      `${entry.missingStatements}`,
      formatPercent(entry.functionsPct),
      formatPercent(entry.branchesPct),
    ]);

  const bestCovered = [...fileEntries]
    .sort((a, b) => b.statementsPct - a.statementsPct)
    .slice(0, 5)
    .map((entry) => [
      entry.file,
      formatPercent(entry.statementsPct),
      formatPercent(entry.functionsPct),
      formatPercent(entry.branchesPct),
      formatPercent(entry.linesPct),
    ]);

  const content = [
    '# Test Coverage Metrics',
    '',
    `_Last updated: ${new Date().toISOString()}_`,
    '',
    'Generated via `npm run coverage:metrics`. This command runs `vitest` with coverage enabled and summarizes the results below.',
    '',
    '## Overall Coverage',
    '',
    buildTable(overallRows, ['Metric', 'Covered', 'Total', 'Percent']),
    '',
    '## Largest Coverage Gaps (by statements)',
    '',
    buildTable(worstCovered, ['File', 'Statements %', 'Missing Stmts', 'Functions %', 'Branches %']),
    '',
    '## Highest Coverage Highlights',
    '',
    buildTable(bestCovered, ['File', 'Statements %', 'Functions %', 'Branches %', 'Lines %']),
    '',
    '> Tip: Focus on the files in the gap table to quickly raise effective coverage.',
    '',
  ].join('\n');

  await writeFile(outputPath, content, 'utf8');
}

async function main() {
  await runVitestCoverage();
  const raw = await readFile(summaryPath, 'utf8');
  const summary = JSON.parse(raw);
  const fileEntries = buildFileEntries(summary);
  await writeReport(summary.total || {}, fileEntries);
}

main().catch((error) => {
  console.error('[coverage:metrics] Failed to generate report:', error.message);
  process.exitCode = 1;
});
