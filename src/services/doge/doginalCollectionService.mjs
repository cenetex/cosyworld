/**
 * DoginalCollectionService
 * Ingests Dogecoin inscription collections (Doginals) and provides lookup & summon helpers.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { globby } from 'globby';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MANIFEST_DIR = path.join(PROJECT_ROOT, 'data', 'doginals');

function normalizeKey(value) {
  if (!value) return null;
  return String(value).trim().toLowerCase();
}

function normalizeAlias(value) {
  if (!value) return null;
  return normalizeKey(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeLinks(input) {
  if (!input) return [];
  const items = Array.isArray(input) ? input : [input];
  const results = [];
  for (const item of items) {
    if (!item) continue;
    if (typeof item === 'string') {
      const url = item.trim();
      if (/^https?:\/\//i.test(url)) {
        results.push({ label: 'View', url });
      }
      continue;
    }
    if (typeof item === 'object') {
      const url = item.url || item.href || item.link || null;
      if (!url || !/^https?:\/\//i.test(url)) continue;
      const label = item.label || item.title || item.name || 'View';
      results.push({ label, url });
    }
  }
  return results;
}

function normalizeOrdinalId(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (/^[0-9a-f]{64}i\d+$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
  }
  return null;
}

async function fetchRemoteManifestTokens(url, logger) {
  if (!url) return { tokens: [], raw: null };
  if (typeof fetch !== 'function') {
    throw new Error('fetch API is not available in this runtime');
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'CosyWorld-DoginalSync/1.0',
      'Accept': 'application/json',
    },
  }).catch((error) => {
    throw new Error(`Network error: ${error.message}`);
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${error.message}`);
  }

  const tokens = extractTokensFromRemote(json);
  if (!Array.isArray(tokens) || !tokens.length) {
    throw new Error('Remote manifest did not include a non-empty tokens array');
  }

  logger?.info?.(`[doginals] fetched ${tokens.length} tokens from ${url}`);
  return { tokens, raw };
}

function manifestNameFallback(slug) {
  if (!slug) return 'Doginal';
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function extensionFromMime(mime) {
  if (!mime) return 'bin';
  const type = mime.toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('gif')) return 'gif';
  if (type.includes('webp')) return 'webp';
  if (type.includes('svg')) return 'svg';
  return 'bin';
}

function extractTokensFromRemote(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.tokens)) return payload.tokens;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.collection?.tokens)) return payload.collection.tokens;
  if (Array.isArray(payload.collection?.items)) return payload.collection.items;
  if (Array.isArray(payload.data?.tokens)) return payload.data.tokens;
  if (Array.isArray(payload.data?.items)) return payload.data.items;

  const objectCandidates = [
    payload.tokens,
    payload.items,
    payload.collection?.tokens,
    payload.collection?.items,
    payload.data?.tokens,
    payload.data?.items,
    payload.collection,
    payload.data,
    payload,
  ];

  for (const candidate of objectCandidates) {
    const tokens = tokensFromObjectMap(candidate);
    if (tokens.length) return tokens;
  }
  return [];
}

function tokensFromObjectMap(mapLike) {
  if (!mapLike || typeof mapLike !== 'object' || Array.isArray(mapLike)) return [];
  const tokens = [];
  for (const [key, value] of Object.entries(mapLike)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const candidate = { ...value };
    const normalizedKey = normalizeOrdinalId(key) || key;
    if (!candidate.inscriptionId && typeof normalizedKey === 'string') {
      candidate.inscriptionId = normalizedKey;
    }
    if (!candidate.dogeLabsId && typeof normalizedKey === 'string') {
      candidate.dogeLabsId = normalizeOrdinalId(normalizedKey) || candidate.inscriptionId;
    }
    tokens.push(candidate);
  }
  return tokens;
}

function deriveDogeLabsUrl(slug, inscriptionId) {
  const canonicalSlug = (slug || '').trim();
  const canonicalId = normalizeOrdinalId(inscriptionId) || inscriptionId;
  if (!canonicalSlug || !canonicalId) return null;
  return `https://doge-labs.com/collectible/${canonicalSlug}/${canonicalId}`;
}

function tokenMergeKey(token) {
  const id = normalizeOrdinalId(
    token?.inscriptionId,
    token?.dogeLabsId,
    token?.ordinalId,
    token?.metadata?.inscriptionId,
    token?.metadata?.ordinalId,
    token?.metadata?.ordinal?.id,
    token?.metadata?.inscription?.id,
    token?.metadata?.ordinalsId,
  );
  if (id) return `id:${id}`;
  const number = token?.inscriptionNumber;
  if (number != null) return `num:${number}`;
  const fallback = token?.inscriptionId || token?.dogeLabsId || token?.id;
  return fallback ? `fallback:${fallback}` : null;
}

function mergeTokenLists(primary = [], secondary = []) {
  if (!secondary.length) return primary.slice();
  const merged = new Map();
  let anonCounter = 0;

  for (const token of primary) {
    const key = tokenMergeKey(token) || `anon:${anonCounter++}`;
    merged.set(key, { ...token });
  }

  for (const token of secondary) {
    const key = tokenMergeKey(token) || `sec:${anonCounter++}`;
    if (merged.has(key)) {
      const existing = merged.get(key);
      merged.set(key, mergeToken(existing, token));
    } else {
      merged.set(key, { ...token });
    }
  }

  return Array.from(merged.values());
}

function mergeToken(base, incoming) {
  const merged = { ...incoming, ...base };
  merged.image = mergeImage(base?.image, incoming?.image);
  merged.links = mergeLinks(base?.links, incoming?.links);
  return merged;
}

function mergeImage(baseImage, incomingImage) {
  if (!incomingImage) return baseImage || null;
  if (!baseImage) return incomingImage;
  return {
    ...incomingImage,
    ...baseImage,
  };
}

function mergeLinks(baseLinks, incomingLinks) {
  const list = [];
  const set = new Set();
  const append = (links) => {
    if (!links) return;
    for (const link of links) {
      if (!link || typeof link !== 'object') continue;
      const url = link.url || link.href;
      if (!url) continue;
      const key = url.toLowerCase();
      if (set.has(key)) continue;
      set.add(key);
      list.push({ label: link.label || link.title || link.name || 'View', url });
    }
  };
  append(baseLinks);
  append(incomingLinks);
  return list;
}

export class DoginalCollectionService {
  constructor({ databaseService, logger, s3Service }) {
    this.databaseService = databaseService;
    this.logger = logger?.child ? logger.child({ service: 'DoginalCollectionService' }) : logger;
    this.s3Service = s3Service ?? null;
    this.maestroKey = (process.env.MAESTRO_API_KEY || '').trim() || null;
    this.maestroBaseUrl = (process.env.MAESTRO_API_BASE || 'https://xdg-mainnet.gomaestro-api.org/v0').replace(/\/$/, '');

    this.collectionsBySlug = new Map();
    this.aliasToSlug = new Map();
    this.bootstrapPromise = this.bootstrap();
  }

  async ensureReady() {
    if (this.bootstrapPromise) {
      try {
        await this.bootstrapPromise;
      } finally {
        this.bootstrapPromise = null; // prevent redundant awaits once resolved
      }
    }
  }

  async bootstrap() {
    try {
      const db = await this.databaseService.getDatabase();
      if (!db) {
        throw new Error('Mongo database unavailable');
      }
      await this.loadLocalManifests();
      await this.refreshCache();
      this.logger?.info?.('[doginals] bootstrap completed');
    } catch (error) {
      this.logger?.error?.('[doginals] bootstrap failed:', error);
    }
  }

  async loadLocalManifests() {
    try {
      const stats = await fs.stat(MANIFEST_DIR).catch(() => null);
      if (!stats || !stats.isDirectory()) {
        return;
      }
      const files = await globby('*.json', { cwd: MANIFEST_DIR, absolute: true });
      for (const file of files) {
        try {
          await this.ingestManifest(file, { skipIfUnchanged: true });
        } catch (error) {
          this.logger?.error?.(`[doginals] Failed to ingest manifest ${file}: ${error.message}`);
          await this.recordIngestionJob({
            collectionSlug: path.basename(file, '.json'),
            status: 'failed',
            runAt: new Date(),
            stats: { fetched: 0, updated: 0, skipped: 0, errors: 1 },
            error: error.message,
            source: { type: 'file', filePath: path.relative(PROJECT_ROOT, file) }
          });
        }
      }
    } catch (error) {
      this.logger?.warn?.('[doginals] loadLocalManifests failed:', error.message);
    }
  }

  async ingestManifest(filePath, { skipIfUnchanged = false } = {}) {
    const db = await this.databaseService.getDatabase();
    if (!db) throw new Error('Mongo database unavailable');
    const raw = await fs.readFile(filePath, 'utf8');
    const manifest = JSON.parse(raw);
    const slug = normalizeKey(manifest.slug || path.basename(filePath, '.json'));
    if (!slug) throw new Error('Manifest missing slug');

    const { tokens, remoteRaw } = await this.resolveTokensFromManifest({ manifest, filePath, slug });

    const hash = crypto.createHash('sha256')
      .update(raw)
      .update(remoteRaw || '')
      .digest('hex');
    const collectionsColl = db.collection('doge_collections');
    const existing = await collectionsColl.findOne({ slug });
    if (skipIfUnchanged && existing?.source?.hash === hash) {
      this.logger?.info?.(`[doginals] Manifest ${slug} unchanged; skipping`);
      return existing;
    }

    const now = new Date();
    const collectionsUpdate = {
      slug,
      name: manifest.name || manifest.title || slug,
      description: manifest.description || '',
      aliases: Array.isArray(manifest.aliases) ? manifest.aliases : [],
      links: normalizeLinks(manifest.links),
      ingestionStatus: 'active',
      featured: Boolean(manifest.featured),
      traitsSchema: Array.isArray(manifest.traitsSchema) ? manifest.traitsSchema : [],
      inscriptionCount: tokens.length,
      previewImage: manifest.previewImage || tokens[0]?.image?.sourceUrl || tokens[0]?.image,
      source: {
        type: manifest.source?.type || 'file',
        url: manifest.source?.url || null,
        filePath: path.relative(PROJECT_ROOT, filePath),
        hash,
        remoteHash: remoteRaw ? crypto.createHash('sha256').update(remoteRaw).digest('hex') : null,
      },
      updatedAt: now,
    };

    await collectionsColl.updateOne(
      { slug },
      { $set: collectionsUpdate, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );

    const tokensColl = db.collection('doge_tokens');
    if (tokens.length) {
      const ops = tokens.map((token) => {
        const dogeLabsId = token.dogeLabsId
          || token.metadata?.dogeLabsId
          || token.metadata?.ordinalId
          || token.metadata?.inscriptionId
          || token.metadata?.ordinal?.id
          || token.metadata?.inscription?.id
          || token.metadata?.ordinalsId
          || token.ordinalId
          || token.inscriptionOrdinalId
          || null;

        const normalizedOrdinalId = normalizeOrdinalId(
          token.inscriptionId,
          dogeLabsId,
          token.ordinalId,
          token.metadata?.inscriptionId,
          token.metadata?.ordinalId,
          token.metadata?.ordinal?.id,
          token.metadata?.inscription?.id,
          token.metadata?.ordinalsId,
        );

        const fallbackInscriptionId = token.inscriptionId || token.id || `inscription-${token.inscriptionNumber ?? crypto.randomUUID()}`;
        const inscriptionId = normalizedOrdinalId || fallbackInscriptionId;
        const imageSource = token.image?.sourceUrl || token.image?.url || token.image || null;
        const cdnUrl = token.image?.cdnUrl || imageSource || null;
        const traits = token.traits && typeof token.traits === 'object' ? token.traits : {};
        const rarity = typeof token.rarity === 'number' ? token.rarity : null;
        const summonWeight = Number.isFinite(token.summonWeight) ? Number(token.summonWeight) : 1;
        const links = normalizeLinks(token.links || token.link || token.urls);
        let detailsUrl = token.detailsUrl || token.metadata?.detailsUrl || null;
        const usableDogeLabsId = normalizeOrdinalId(dogeLabsId);
        const dogeLabsUrl = deriveDogeLabsUrl(slug, usableDogeLabsId || normalizedOrdinalId);
        if (!detailsUrl && dogeLabsUrl) {
          detailsUrl = dogeLabsUrl;
        }
        if (dogeLabsUrl && !links.some(link => link.url === dogeLabsUrl)) {
          links.push({ label: 'View on Doge Labs', url: dogeLabsUrl });
        }
        return {
          updateOne: {
            filter: { collectionSlug: slug, inscriptionId },
            update: {
              $set: {
                collectionSlug: slug,
                inscriptionId,
                inscriptionNumber: token.inscriptionNumber ?? null,
                name: token.name || `${manifest.name || 'Doginal'} ${token.inscriptionNumber ?? ''}`.trim(),
                traits,
                rarity,
                summonWeight,
                image: {
                  sourceUrl: imageSource,
                  cdnUrl,
                  width: token.image?.width || null,
                  height: token.image?.height || null,
                  hash: token.image?.hash || null,
                },
                links,
                dogeLabsId: usableDogeLabsId || dogeLabsId || null,
                detailsUrl,
                lastKnownOwner: token.lastKnownOwner || token.owner || null,
                metadata: token.metadata || token.raw || null,
                syncedAt: now,
              },
              $setOnInsert: { createdAt: now },
            },
            upsert: true,
          }
        };
      });
      if (ops.length) {
        try {
          await tokensColl.bulkWrite(ops, { ordered: false });
        } catch (error) {
          this.logger?.warn?.(`[doginals] bulkWrite partial failure for ${slug}: ${error.message}`);
        }
      }
    }

    await this.recordIngestionJob({
      collectionSlug: slug,
      status: 'success',
      runAt: now,
      stats: { fetched: tokens.length, updated: tokens.length, skipped: 0, errors: 0 },
      source: { type: 'file', filePath: path.relative(PROJECT_ROOT, filePath), hash }
    });

    // Refresh caches after ingest
    await this.refreshCache();
    return await collectionsColl.findOne({ slug });
  }

  async resolveTokensFromManifest({ manifest, filePath, slug }) {
    const localTokens = Array.isArray(manifest.tokens) ? manifest.tokens : [];
    let tokens = localTokens;
    let remoteRaw = null;

    const remoteUrl = manifest.remoteTokens?.url
      || manifest.source?.remoteUrl
      || manifest.source?.url
      || manifest.remoteUrl
      || null;

    if (remoteUrl) {
      try {
        const remote = await fetchRemoteManifestTokens(remoteUrl, this.logger);
        if (Array.isArray(remote.tokens) && remote.tokens.length) {
          tokens = remote.tokens;
          remoteRaw = remote.raw;
        }
      } catch (error) {
        this.logger?.warn?.(`[doginals] Failed to fetch remote tokens for ${slug || filePath}: ${error.message}`);
      }
    }

    if (!tokens.length && !remoteUrl) {
      this.logger?.warn?.(`[doginals] Manifest ${slug || filePath} has no tokens array`);
    }

    const maestroConfig = manifest.maestro || manifest.source?.maestro || null;
    if (this.maestroKey && maestroConfig) {
      try {
        const maestroTokens = await this.fetchTokensFromMaestroListing(maestroConfig, slug);
        if (maestroTokens.length) {
          tokens = mergeTokenLists(tokens, maestroTokens);
        }
      } catch (error) {
        this.logger?.warn?.(`[doginals] Maestro listing failed for ${slug || filePath}: ${error.message}`);
      }
    }

    if (tokens.length && this.maestroKey) {
      try {
        tokens = await this.enrichTokensWithMaestro(tokens, slug);
      } catch (error) {
        this.logger?.warn?.(`[doginals] Maestro enrichment failed for ${slug || filePath}: ${error.message}`);
      }
    }

    return { tokens, remoteRaw };
  }

  async recordIngestionJob(doc) {
    try {
      const db = await this.databaseService.getDatabase();
      if (!db) throw new Error('Mongo database unavailable');
      await db.collection('doge_ingestion_jobs').insertOne({ ...doc });
    } catch (error) {
      this.logger?.warn?.('[doginals] Failed to record ingestion job:', error.message);
    }
  }

  async enrichTokensWithMaestro(baseTokens, slug) {
    const results = [];
    for (const token of baseTokens) {
      try {
        const enriched = await this.enrichTokenWithMaestro(token, slug);
        results.push(enriched);
      } catch (error) {
        this.logger?.warn?.(`[doginals] Maestro token enrichment failed for ${slug || 'unknown'} (${token?.inscriptionId || token?.dogeLabsId || 'n/a'}): ${error.message}`);
        results.push(token);
      }
    }
    return results;
  }

  async fetchTokensFromMaestroListing(config = {}, slug) {
    if (!this.maestroKey) throw new Error('Maestro API key not configured');
    if (typeof fetch !== 'function') throw new Error('fetch API is unavailable for Maestro requests');

    const pageSize = Math.max(1, Math.min(parseInt(config.pageSize ?? config.count ?? 200, 10) || 200, 500));
    const maxPages = Math.max(1, Math.min(parseInt(config.maxPages ?? 50, 10) || 50, 500));
    const stopAfter = Math.max(1, parseInt(config.limit ?? config.maxItems ?? 0, 10) || 0);

    let cursor = config.cursor || null;
    const collected = [];

    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(`${this.maestroBaseUrl}/dunes/inscriptions`);
      url.searchParams.set('count', String(pageSize));
      if (cursor) url.searchParams.set('cursor', cursor);

      const collectionSlug = config.collectionSlug || config.collection || config.slug || slug;
      if (collectionSlug) {
        url.searchParams.set('collection_slug', collectionSlug);
        url.searchParams.set('collection', collectionSlug);
      }

      const collectionId = config.collectionId || config.collection_id;
      if (collectionId) {
        url.searchParams.set('collection_id', collectionId);
      }

      const owner = config.ownerAddress || config.owner_address || config.owner;
      if (owner) {
        url.searchParams.set('owner_address', owner);
      }

      if (config.tag) {
        url.searchParams.set('tag', config.tag);
      }

      const res = await fetch(url, { headers: this.maestroHeaders() });
      if (!res.ok) {
        throw new Error(`Maestro listing HTTP ${res.status}`);
      }

      const body = await res.json();
      const items = body?.data?.items || body?.items || [];
      for (const item of items) {
        const inscriptionId = normalizeOrdinalId(
          item.inscription_id,
          item.id,
          item.ordinal_id,
          item.inscriptionId,
        );
        if (!inscriptionId) continue;

        const inscriptionNumber = item.inscription_number ?? item.inscriptionNumber ?? null;
        const ownerAddress = item.owner_address || item.owner || item.last_known_owner || null;
        const urlFromDogeLabs = deriveDogeLabsUrl(collectionSlug, inscriptionId);

        const token = {
          inscriptionId,
          inscriptionNumber,
          dogeLabsId: inscriptionId,
          lastKnownOwner: ownerAddress,
          metadata: {
            maestroListing: item,
          },
        };

        if (urlFromDogeLabs) {
          token.links = [{ label: 'View on Doge Labs', url: urlFromDogeLabs }];
          token.detailsUrl = token.detailsUrl || urlFromDogeLabs;
        }

        collected.push(token);
        if (stopAfter && collected.length >= stopAfter) {
          return collected;
        }
      }

      cursor = body?.data?.next_cursor || body?.next_cursor || body?.cursor || null;
      if (!cursor) break;
    }

    return collected;
  }

  async enrichTokenWithMaestro(token, slug) {
    if (typeof fetch !== 'function') {
      throw new Error('fetch API is unavailable for Maestro requests');
    }

    const inscriptionId = normalizeOrdinalId(
      token.inscriptionId,
      token.dogeLabsId,
      token.ordinalId,
      token.metadata?.inscriptionId,
      token.metadata?.ordinalId,
      token.metadata?.ordinal?.id,
      token.metadata?.inscription?.id,
      token.metadata?.ordinalsId,
    );

    if (!inscriptionId) {
      throw new Error('missing canonical inscriptionId');
    }

    const metadata = await this.fetchMaestroInscription(inscriptionId);
    const info = metadata?.data || metadata || {};

    const existingImage = typeof token.image === 'string'
      ? { sourceUrl: token.image }
      : (token.image || {});

    const enriched = {
      ...token,
      image: existingImage,
    };

    enriched.inscriptionId = info.inscription_id || inscriptionId;
    if (info.inscription_number != null) {
      enriched.inscriptionNumber = info.inscription_number;
    }

    const owner = info.owner_address || info.owner || info.last_known_owner;
    if (owner) {
      enriched.lastKnownOwner = owner;
    }

    const contentType = info.content_type || info.mime_type || existingImage.contentType || null;
    const ensuredImage = await this.ensureTokenImage(enriched, inscriptionId, contentType).catch((error) => {
      this.logger?.warn?.(`[doginals] Maestro image ensure failed for ${inscriptionId}: ${error.message}`);
      return null;
    });

    if (ensuredImage) {
      enriched.image = {
        ...enriched.image,
        sourceUrl: ensuredImage.sourceUrl,
        cdnUrl: ensuredImage.cdnUrl || ensuredImage.sourceUrl,
        width: ensuredImage.width ?? enriched.image?.width ?? null,
        height: ensuredImage.height ?? enriched.image?.height ?? null,
        hash: ensuredImage.hash ?? enriched.image?.hash ?? null,
        contentType: contentType || enriched.image?.contentType || null,
      };
    } else if (contentType) {
      enriched.image = {
        ...enriched.image,
        contentType,
      };
    }

    const maestroMeta = {
      ...info,
      fetchedAt: new Date().toISOString(),
    };

    const baseMetadata = (enriched.metadata && typeof enriched.metadata === 'object' && !Array.isArray(enriched.metadata))
      ? enriched.metadata
      : {};

    enriched.metadata = {
      ...baseMetadata,
      maestro: maestroMeta,
    };

    const dogeLabsUrl = deriveDogeLabsUrl(slug, inscriptionId);
    if (dogeLabsUrl) {
      const existingLinks = Array.isArray(enriched.links) ? enriched.links : [];
      if (!existingLinks.some(link => link?.url === dogeLabsUrl)) {
        enriched.links = [...existingLinks, { label: 'View on Doge Labs', url: dogeLabsUrl }];
      } else {
        enriched.links = existingLinks;
      }
      enriched.detailsUrl = enriched.detailsUrl || dogeLabsUrl;
    }

    if (!enriched.name) {
      const baseName = info.title || info.name || manifestNameFallback(slug);
      const suffix = enriched.inscriptionNumber != null ? ` #${enriched.inscriptionNumber}` : '';
      enriched.name = `${baseName}${suffix}`.trim();
    }

    return enriched;
  }

  async fetchMaestroInscription(inscriptionId) {
    if (!this.maestroKey) throw new Error('Maestro API key not configured');
    const url = new URL(`${this.maestroBaseUrl}/assets/inscriptions/${inscriptionId}`);
    const res = await fetch(url, { headers: this.maestroHeaders() });
    if (!res.ok) {
      throw new Error(`Maestro HTTP ${res.status}`);
    }
    return await res.json();
  }

  async fetchMaestroContent(inscriptionId, cursor = null) {
    if (!this.maestroKey) throw new Error('Maestro API key not configured');
    const url = new URL(`${this.maestroBaseUrl}/assets/inscriptions/${inscriptionId}/content_body`);
    url.searchParams.set('count', '4096');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: this.maestroHeaders() });
    if (!res.ok) {
      throw new Error(`Maestro content HTTP ${res.status}`);
    }
    return await res.json();
  }

  async ensureTokenImage(token, inscriptionId, contentType) {
    const currentSource = token.image?.sourceUrl || token.image?.cdnUrl || token.image?.url;
    if (currentSource) {
      return {
        sourceUrl: currentSource,
        cdnUrl: token.image?.cdnUrl || null,
      };
    }

    if (!contentType || !/^image\//i.test(contentType)) {
      return null;
    }

    if (!this.s3Service?.uploadImage) {
      return null;
    }

    let cursor = null;
    let guard = 0;
    const chunks = [];

    do {
      const payload = await this.fetchMaestroContent(inscriptionId, cursor);
      const page = payload?.data?.content_body_page;
      if (page) chunks.push(page);
      cursor = payload?.next_cursor || null;
      guard += 1;
      if (!cursor || guard > 2048) break;
    } while (true);

    if (!chunks.length) {
      return null;
    }

    let buffer;
    try {
      buffer = Buffer.from(chunks.join(''), 'base64');
    } catch (error) {
      throw new Error(`Failed decoding Maestro content: ${error.message}`);
    }

    const uploadUrl = await this.uploadImageBuffer(buffer, contentType);
    if (!uploadUrl) {
      return null;
    }

    return {
      sourceUrl: uploadUrl,
      cdnUrl: uploadUrl,
    };
  }

  async uploadImageBuffer(buffer, contentType) {
    if (!buffer?.length) return null;
    if (!this.s3Service?.uploadImage) return null;

    const ext = extensionFromMime(contentType);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doginals-'));
    const tmpFile = path.join(tmpDir, `asset.${ext}`);
    try {
      await fs.writeFile(tmpFile, buffer);
      const uploaded = await this.s3Service.uploadImage(tmpFile);
      return uploaded || null;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  maestroHeaders() {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'CosyWorld-DoginalSync/1.0',
    };
    if (this.maestroKey) headers['api-key'] = this.maestroKey;
    return headers;
  }

  async refreshCache() {
    const db = await this.databaseService.getDatabase();
    const docs = await db.collection('doge_collections').find({}).toArray();
    this.collectionsBySlug.clear();
    this.aliasToSlug.clear();

    for (const doc of docs) {
      const slug = doc.slug;
      if (!slug) continue;
      this.collectionsBySlug.set(slug, doc);
      const aliases = new Set([slug, doc.name, ...(doc.aliases || [])]);
      for (const alias of aliases) {
        const normalized = normalizeAlias(alias);
        if (!normalized) continue;
        this.aliasToSlug.set(normalized, slug);
        // also map hyphenated version
        this.aliasToSlug.set(normalized.replace(/\s+/g, '-'), slug);
      }
    }
  }

  async listCollections({ activeOnly = true } = {}) {
    await this.ensureReady();
    const all = Array.from(this.collectionsBySlug.values());
    return activeOnly ? all.filter(c => c.ingestionStatus !== 'error') : all;
  }

  async getCollection(input) {
    await this.ensureReady();
    if (!input) return null;
    const direct = this.collectionsBySlug.get(normalizeKey(input)) || this.collectionsBySlug.get(input);
    if (direct) return direct;
    const alias = this.aliasToSlug.get(normalizeAlias(input));
    if (alias) return this.collectionsBySlug.get(alias) || null;
    return null;
  }

  async getTokens({ slug, page = 1, limit = 40, traits = null } = {}) {
    await this.ensureReady();
    if (!slug) throw Object.assign(new Error('Collection slug required'), { status: 400 });
    const collection = await this.getCollection(slug);
    if (!collection) throw Object.assign(new Error('Collection not found'), { status: 404 });

    const db = await this.databaseService.getDatabase();
    const filter = { collectionSlug: collection.slug };
    if (traits && typeof traits === 'object') {
      for (const [key, value] of Object.entries(traits)) {
        if (value == null || value === '') continue;
        filter[`traits.${key}`] = value;
      }
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 200);
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const tokensColl = db.collection('doge_tokens');
    const [items, total] = await Promise.all([
      tokensColl.find(filter).sort({ inscriptionNumber: 1 }).skip(skip).limit(safeLimit).toArray(),
      tokensColl.countDocuments(filter)
    ]);

    return {
      collection,
      items,
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    };
  }

  async summonToken({ collection: collectionInput, inscriptionNumber, inscriptionId, exclude = [], traits = null }) {
    await this.ensureReady();
    const collection = await this.getCollection(collectionInput);
    if (!collection) throw Object.assign(new Error('Collection not found'), { status: 404 });

    const db = await this.databaseService.getDatabase();
    const tokensColl = db.collection('doge_tokens');

    const normalizedExclude = Array.isArray(exclude) ? exclude : [exclude].filter(Boolean);
    const excludeNumbers = normalizedExclude
      .map(v => parseInt(String(v).replace(/[^0-9]/g, ''), 10))
      .filter(v => Number.isFinite(v));
    const excludeIds = normalizedExclude
      .map(v => String(v).trim())
      .filter(v => !!v && !Number.isFinite(parseFloat(v)));

    const filter = { collectionSlug: collection.slug };
    if (excludeIds.length) {
      filter.inscriptionId = { $nin: excludeIds };
    }
    if (excludeNumbers.length) {
      filter.inscriptionNumber = { $nin: excludeNumbers };
    }
    if (traits && typeof traits === 'object') {
      for (const [key, value] of Object.entries(traits)) {
        if (value == null || value === '') continue;
        filter[`traits.${key}`] = value;
      }
    }

    let token = null;
    if (inscriptionNumber != null || inscriptionId) {
      const num = inscriptionNumber != null ? parseInt(String(inscriptionNumber).replace(/[^0-9]/g, ''), 10) : null;
      const id = inscriptionId ? String(inscriptionId).trim() : null;
      const numberFilter = num != null && Number.isFinite(num) ? { inscriptionNumber: num } : {};
      const idFilter = id ? { inscriptionId: id } : {};
      token = await tokensColl.findOne({ ...filter, ...numberFilter, ...idFilter });
      if (!token) {
        throw Object.assign(new Error('Requested inscription not found'), { status: 404 });
      }
    } else {
      // Random selection using aggregation sample to avoid loading entire collection
      const pipeline = [{ $match: filter }, { $sample: { size: 1 } }];
      const [sampled] = await tokensColl.aggregate(pipeline).toArray();
      if (!sampled) {
        throw Object.assign(new Error('No available inscriptions for summon'), { status: 404 });
      }
      token = sampled;
    }

    return { collection, token };
  }
}

export default DoginalCollectionService;
