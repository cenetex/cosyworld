import { spawn } from 'node:child_process';

const COVERAGE_THRESHOLD = 80;

function runTests() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--test', '--experimental-test-coverage'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test' }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Tests failed with exit code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseCoverage(stdout) {
  const lines = stdout.split('\n');
  const summaryLine = lines.find((line) => line.includes('all files'));
  if (!summaryLine) {
    throw new Error('Unable to locate coverage summary.');
  }

  const match = summaryLine.match(/\|\s*([0-9.]+)\s*\|/);
  if (!match) {
    throw new Error('Unable to parse coverage percentage.');
  }

  return Number.parseFloat(match[1]);
}

async function main() {
  try {
    const { stdout } = await runTests();
    const lineCoverage = parseCoverage(stdout);
    if (Number.isNaN(lineCoverage) || lineCoverage < COVERAGE_THRESHOLD) {
      console.error(`Coverage check failed: expected >= ${COVERAGE_THRESHOLD}% line coverage, received ${lineCoverage.toFixed(2)}%.`);
      process.exit(1);
    }
    console.log(`Coverage check passed: ${lineCoverage.toFixed(2)}% line coverage.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
