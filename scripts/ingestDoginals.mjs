#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { container, containerReady } from '../src/container.mjs';

async function resolveManifestPaths(slug) {
  const baseDir = path.resolve(process.cwd(), 'data', 'doginals');
  const stat = await fs.stat(baseDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Manifest directory not found: ${baseDir}`);
  }

  if (slug) {
    const file = path.join(baseDir, `${slug}.json`);
    await fs.access(file);
    return [file];
  }

  const entries = await fs.readdir(baseDir);
  return entries
    .filter(name => name.endsWith('.json'))
    .map(name => path.join(baseDir, name));
}

async function main() {
  await containerReady;
  const doginalService = container.resolve('doginalCollectionService');

  const args = process.argv.slice(2);
  const slugArg = args.find(arg => !arg.startsWith('--')) || null;
  const manifests = await resolveManifestPaths(slugArg);

  for (const file of manifests) {
    const slug = path.basename(file, '.json');
    console.log(`[doginals] ingesting ${slug} from ${file}`);
    await doginalService.ingestManifest(file, { skipIfUnchanged: false });
  }

  console.log('[doginals] ingestion complete');
  process.exit(0);
}

main().catch(err => {
  console.error('[doginals] ingestion failed:', err.message || err);
  process.exit(1);
});

