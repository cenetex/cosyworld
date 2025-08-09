#!/usr/bin/env node
/**
 * Sync avatars from an external NFT collection into the avatars collection.
 * Uses .env AVATAR_COLLECTION (e.g., a contract address or collection slug) to fetch metadata.
 * For each NFT:
 *  - name -> avatar.name
 *  - description -> avatar.description
 *  - personality (if provided) -> avatar.personality (else synthesized)
 *  - other traits -> fed into AI to generate a dynamic personality / extended description
 *  - image -> avatar.imageUrl
 * Skips existing avatars by name unless --force provided.
 */
import 'dotenv/config';
import { container } from '../src/container.mjs';
import { computeAgentId, resolveChainId } from '../src/utils/agentIdentity.mjs';
import pkg from 'js-sha3';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const logger = container.resolve('logger');
const avatarService = container.resolve('avatarService');
const databaseService = container.resolve('databaseService');
const configService = container.resolve('configService');
const aiService = container.resolve(process.env.AI_SERVICE === 'google' ? 'googleAIService' : 'aiService');

const COLLECTION = process.env.AVATAR_COLLECTION;
const NFT_API_PROVIDER = (process.env.NFT_API_PROVIDER || '').toLowerCase(); // reservoir | opensea | alchemy | helius
const NFT_API_KEY = process.env.NFT_API_KEY || process.env.RESERVOIR_API_KEY || process.env.OPENSEA_API_KEY || process.env.ALCHEMY_API_KEY || process.env.HELIUS_API_KEY;
const NFT_CHAIN = (process.env.NFT_CHAIN || 'ethereum').toLowerCase(); // 'solana' when using helius
if (!COLLECTION) {
  console.error('AVATAR_COLLECTION not set in environment (.env).');
  process.exit(1);
}

// Simple loader: For now expects a JSON file in ./data/<collection>.json if remote fetch not implemented.
// You can extend this to call an NFT API (e.g., OpenSea, Reservoir, Alchemy) based on COLLECTION value.
async function loadCollectionMetadata() {
  const fileArg = process.argv.find(a => a.startsWith('--file='));
  let source = fileArg ? fileArg.slice('--file='.length) : (process.env.AVATAR_COLLECTION_FILE || path.join(process.cwd(), 'data', `${COLLECTION}.json`));

  // Remote URL fetch support
  if (/^https?:\/\//i.test(source)) {
    try {
      logger.info(`Fetching remote NFT metadata: ${source}`);
      const res = await fetch(source);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.json();
      if (!Array.isArray(arr)) throw new Error('Remote JSON must be an array');
      return arr;
    } catch (e) {
      logger.error(`Failed remote fetch: ${e.message}`);
      throw e;
    }
  }

  // Local file path
  try {
    const raw = await fs.readFile(source, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('Collection JSON must be an array of NFT metadata objects');
    return arr;
  } catch (e) {
    if (e.code !== 'ENOENT') logger.error(`Failed to load metadata file ${source}: ${e.message}`);
    throw e; // no stub creation anymore
  }
}

/* ----------------------------- NFT API FETCHERS ---------------------------- */
async function fetchFromReservoir(collection) {
  if (!NFT_API_KEY) throw new Error('Reservoir API key required (NFT_API_KEY or RESERVOIR_API_KEY).');
  const base = 'https://api.reservoir.tools';
  const tokens = [];
  let continuation = null;
  do {
    const url = new URL(base + '/tokens/v7');
    url.searchParams.set('collection', collection);
    url.searchParams.set('limit', '1000');
    url.searchParams.set('includeAttributes', 'true');
    if (continuation) url.searchParams.set('continuation', continuation);
    const res = await fetch(url, { headers: { 'x-api-key': NFT_API_KEY } });
    if (!res.ok) throw new Error(`Reservoir HTTP ${res.status}`);
    const data = await res.json();
    for (const t of data.tokens || []) {
      const token = t.token || {}; // shape: { name, description, image, attributes }
      tokens.push({
        name: token.name,
        description: token.description,
        image: token.image,
        attributes: (token.attributes || []).map(a => ({ trait_type: a.key, value: a.value }))
      });
    }
    continuation = data.continuation || null;
  } while (continuation);
  return tokens;
}

async function fetchFromOpenSea(collection) {
  if (!NFT_API_KEY) throw new Error('OpenSea API key required (NFT_API_KEY or OPENSEA_API_KEY).');
  // Heuristic: if hex address treat as contract, else slug
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(collection);
  const tokens = [];
  let next = null;
  let page = 0;
  do {
    page++;
    let url;
    if (isAddress) {
      // OpenSea v2: contract assets
      url = new URL(`https://api.opensea.io/api/v2/chain/${NFT_CHAIN}/contract/${collection}/nfts`);
    } else {
      url = new URL(`https://api.opensea.io/api/v2/collections/${collection}/nfts`);
    }
    url.searchParams.set('limit', '50');
    if (next) url.searchParams.set('next', next);
    const res = await fetch(url, { headers: { 'X-API-KEY': NFT_API_KEY } });
    if (!res.ok) throw new Error(`OpenSea HTTP ${res.status}`);
    const data = await res.json();
    for (const nft of data.nfts || []) {
      tokens.push({
        name: nft.name,
        description: nft.description,
        image: nft.image_url || nft.image || nft.display_image_url,
        attributes: (nft.traits || []).map(a => ({ trait_type: a.trait_type, value: a.value }))
      });
    }
    next = data.next || null;
    // safety limit to avoid runaway
    if (page > 200) break;
  } while (next);
  return tokens;
}

async function fetchFromAlchemy(collection) {
  if (!NFT_API_KEY) throw new Error('Alchemy API key required (NFT_API_KEY or ALCHEMY_API_KEY).');
  if (!/^0x[a-fA-F0-9]{40}$/.test(collection)) throw new Error('Alchemy collection fetch requires a contract address in AVATAR_COLLECTION.');
  const host = NFT_CHAIN.includes('base') ? 'base-mainnet.g.alchemy.com' : NFT_CHAIN.includes('polygon') ? 'polygon-mainnet.g.alchemy.com' : 'eth-mainnet.g.alchemy.com';
  let startToken = null;
  const tokens = [];
  let loops = 0;
  do {
    loops++;
    const url = new URL(`https://${host}/nft/v3/${NFT_API_KEY}/getNFTsForCollection`);
    url.searchParams.set('contractAddress', collection);
    url.searchParams.set('withMetadata', 'true');
    if (startToken) url.searchParams.set('startToken', startToken);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Alchemy HTTP ${res.status}`);
    const data = await res.json();
    for (const nft of data.nfts || []) {
      const meta = nft.raw?.metadata || nft.metadata || {};
      tokens.push({
        name: meta.name || nft.title,
        description: meta.description || nft.description,
        image: (meta.image || '').replace('ipfs://', 'https://ipfs.io/ipfs/'),
        attributes: (meta.attributes || []).map(a => ({ trait_type: a.trait_type || a.key, value: a.value }))
      });
    }
    startToken = data.nextToken || null;
    if (loops > 500) break; // safety
  } while (startToken);
  return tokens;
}

async function fetchFromHelius(collection) {
  if (!NFT_API_KEY) throw new Error('Helius API key required (NFT_API_KEY or HELIUS_API_KEY).');
  if (!collection) throw new Error('Solana collection identifier (AVATAR_COLLECTION) required.');
  const endpoint = `https://mainnet.helius-rpc.com/?api-key=${NFT_API_KEY}`;

  async function rpc(method, params) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now().toString(), method, params });
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type':'application/json' }, body });
    if (!res.ok) throw new Error(`Helius RPC HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`Helius RPC error (${method}): ${json.error.message || json.error}`);
    return json.result;
  }

  const tokens = [];

  // Strategy 1: Treat collection value as a creator address
  try {
    let page = 1; const limit = 100; // DAS limit
    while (true) {
      const result = await rpc('getAssetsByCreator', { creatorAddress: collection, page, limit });
      const items = result?.items || [];
      if (!items.length) break;
      for (const it of items) {
        const meta = it?.content?.metadata || it?.content?.json || it?.content || {};
        const name = meta.name || it?.name; if (!name) continue;
        const image = (meta.image || it?.content?.files?.[0]?.uri || '').replace('ipfs://','https://ipfs.io/ipfs/');
        const attrs = meta.attributes || meta.traits || [];
        const normalizedAttrs = Array.isArray(attrs)
          ? attrs.map(a => ({ trait_type: a.trait_type || a.traitType || a.key, value: a.value }))
          : Object.entries(attrs || {}).map(([k,v]) => ({ trait_type: k, value: v }));
  tokens.push({ id: it.id, mint: it.id, name, description: meta.description, image, attributes: normalizedAttrs });
      }
      if (items.length < limit) break;
      page++; if (page > 50) break; // safety
    }
    if (tokens.length) {
      logger.info(`Helius getAssetsByCreator retrieved ${tokens.length} assets.`);
      return tokens;
    }
  } catch (e) {
    logger.warn(`Helius getAssetsByCreator failed / empty: ${e.message}`);
  }

  // Strategy 2: searchAssets by collection grouping (DAS)
  try {
    // Strategy 2: getAssetsByGroup using collection address
    let page = 1; const limit = 100;
    while (true) {
      const result = await rpc('getAssetsByGroup', { groupKey: 'collection', groupValue: collection, page, limit });
      const items = result?.items || [];
      if (!items.length) break;
      for (const it of items) {
        const meta = it?.content?.metadata || it?.content?.json || it?.content || {};
        const name = meta.name || it?.name; if (!name) continue;
        const image = (meta.image || it?.content?.files?.[0]?.uri || '').replace('ipfs://','https://ipfs.io/ipfs/');
        const attrs = meta.attributes || meta.traits || [];
        const normalizedAttrs = Array.isArray(attrs)
          ? attrs.map(a => ({ trait_type: a.trait_type || a.traitType || a.key, value: a.value }))
          : Object.entries(attrs || {}).map(([k,v]) => ({ trait_type: k, value: v }));
  tokens.push({ id: it.id, mint: it.id, name, description: meta.description, image, attributes: normalizedAttrs });
      }
      if (items.length < limit) break;
      page++; if (page > 50) break;
    }
    if (tokens.length) {
      logger.info(`Helius getAssetsByGroup retrieved ${tokens.length} assets.`);
      return tokens;
    }
  } catch (e) {
    logger.warn(`Helius getAssetsByGroup failed / empty: ${e.message}`);
  }

  if (!tokens.length) logger.warn('Helius fetch returned no assets. Verify collection identifier (creator or collection address).');
  return tokens;
}

async function fetchCollectionViaApi(collection) {
  if (!NFT_API_PROVIDER) return null;
  try {
    logger.info(`Fetching NFTs via provider='${NFT_API_PROVIDER}' collection='${collection}' chain='${NFT_CHAIN}'`);
    if (NFT_API_PROVIDER === 'reservoir') return await fetchFromReservoir(collection);
    if (NFT_API_PROVIDER === 'opensea') return await fetchFromOpenSea(collection);
    if (NFT_API_PROVIDER === 'alchemy') return await fetchFromAlchemy(collection);
  if (NFT_API_PROVIDER === 'helius' || NFT_CHAIN === 'solana') return await fetchFromHelius(collection);
    logger.warn(`Unknown NFT_API_PROVIDER '${NFT_API_PROVIDER}'. Skipping API fetch.`);
    return null;
  } catch (e) {
    logger.error(`NFT API fetch failed: ${e.message}`);
    return null;
  }
}

function buildTraitSummary(nft) {
  const traitEntries = [];
  const attrs = nft.attributes || nft.traits || [];
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      const key = a.trait_type || a.type || a.key;
      const val = a.value || a.val || a.trait;
      if (key && val) traitEntries.push(`${key}: ${val}`);
    }
  } else if (attrs && typeof attrs === 'object') {
    for (const [k,v] of Object.entries(attrs)) {
      traitEntries.push(`${k}: ${v}`);
    }
  }
  return traitEntries.join('\n');
}

async function synthesizeDynamicPersonality(baseDescription, providedPersonality, traitSummary, coordinator) {
  const prompt = `You are enriching an avatar personality.\nBase Description:\n${baseDescription}\n\nProvided Personality (optional):\n${providedPersonality || 'N/A'}\n\nTraits:\n${traitSummary}\n\nCoordinator / Faction: ${coordinator || 'Unknown'}\n\nTask: Combine these into an in‑universe first‑person style dynamic internal monologue (120-200 words). Capture motivations, subtle flaws, and how the traits influence behavior. Avoid repeating raw trait labels.`;
  try {
    const response = await aiService.chat([
      { role: 'system', content: 'You craft nuanced RPG character internal voices.' },
      { role: 'user', content: prompt }
    ]);
    return response;
  } catch (e) {
    logger.warn('Failed to synthesize dynamic personality: ' + e.message);
    return providedPersonality || baseDescription;
  }
}

async function upsertAvatarFromNft(nft, { force = false } = {}) {
  const db = await databaseService.getDatabase();
  const avatarsCol = db.collection('avatars');
  const name = (nft.name || '').trim();
  if (!name) { logger.warn('Skipping NFT with no name.'); return; }
  const existing = await avatarsCol.findOne({ name });
  if (existing && !force) {
    logger.info(`Skipping existing avatar: ${name}`);
    return existing;
  }

  const description = nft.description?.trim() || 'A mysterious entity.';
  const providedPersonality = nft.personality?.trim() || nft.attributes?.Personality || null;
  const traitSummary = buildTraitSummary(nft);
  const coordinator = nft.attributes?.Coordinator || nft.attributes?.Faction || null;
  const dynamicPersonality = await synthesizeDynamicPersonality(description, providedPersonality, traitSummary, coordinator);

  const rawImageUrl = (nft.image || nft.image_url || nft.media || '').replace('ipfs://', 'https://ipfs.io/ipfs/');
  // Download + rehost to S3
  let imageUrl = rawImageUrl;
  try {
    if (rawImageUrl) {
      const s3Service = container.resolve('s3Service');
      const buf = await s3Service.downloadImage(rawImageUrl).catch(() => null);
      if (buf) {
        const ext = rawImageUrl.split('?')[0].split('.').pop().toLowerCase();
        const valid = ['png','jpg','jpeg','gif'];
        const useExt = valid.includes(ext) ? ext : 'png';
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nft-'));
        const tmpFile = path.join(tmpDir, 'img.' + useExt);
        await fs.writeFile(tmpFile, buf);
        const uploaded = await s3Service.uploadImage(tmpFile).catch(()=>null);
        if (uploaded) imageUrl = uploaded;
      }
    }
  } catch (e) {
    logger.warn(`Rehosting failed for ${rawImageUrl}: ${e.message}`);
  }
  const model = await aiService?.getModel?.(nft.model || '');

  // Determine agent identity (optional if token id resolvable)
  const explicitChainId = process.env.NFT_CHAIN_ID ? Number(process.env.NFT_CHAIN_ID) : undefined;
  const chainId = resolveChainId(NFT_CHAIN, explicitChainId);
  const originContract = COLLECTION; // treat collection identifier as namespace / contract
  const rawToken = nft.token_id || nft.tokenId || nft.mint || nft.id || null;
  let tokenNumeric = null;
  if (rawToken && /^\d+$/.test(String(rawToken))) tokenNumeric = BigInt(rawToken);
  else if (rawToken && /^0x[0-9a-fA-F]+$/.test(String(rawToken))) tokenNumeric = BigInt(rawToken);
  else if (rawToken) {
    tokenNumeric = BigInt('0x' + pkg.keccak_256(rawToken).slice(0,16));
  }
  let agentId = null;
  try { if (tokenNumeric != null) agentId = computeAgentId({ chainId, originContract, tokenId: tokenNumeric }); } catch {}

  const doc = {
    name,
    description,
    personality: providedPersonality || 'Reserved yet undefined.',
    dynamicPersonality,
    emoji: nft.emoji || '🧬',
    model,
    imageUrl,
    source: 'nft-sync',
    collection: COLLECTION,
    nft: {
      collection: COLLECTION,
      tokenId: nft.token_id || nft.tokenId || nft.mint || nft.id || null,
      chain: NFT_CHAIN === 'solana' ? 'solana' : (NFT_CHAIN || 'ethereum'),
      originalImageUrl: rawImageUrl,
      provider: NFT_API_PROVIDER || null,
      fetchedAt: new Date()
    },
    agentId: agentId || null,
    chainId: agentId ? chainId : undefined,
    originContract: agentId ? originContract : undefined,
    traits: nft.attributes || nft.traits || [],
    updatedAt: new Date(),
    createdAt: existing?.createdAt || new Date(),
    channelId: existing?.channelId || null,
    status: existing?.status || 'alive',
    lives: existing?.lives ?? 3
  };

  if (existing) {
    await avatarsCol.updateOne({ _id: existing._id }, { $set: doc });
    logger.info(`Updated avatar from NFT: ${name}`);
    return await avatarsCol.findOne({ _id: existing._id });
  } else {
    const { insertedId } = await avatarsCol.insertOne(doc);
    logger.info(`Inserted new avatar from NFT: ${name}`);
    return { ...doc, _id: insertedId };
  }
}

async function main() {
  logger.info(`Starting NFT avatar sync for collection: ${COLLECTION}`);
  await databaseService.getDatabase();
  // Priority: explicit API provider -> API fetch; else local file; else both merged if both exist.
  let apiNfts = await fetchCollectionViaApi(COLLECTION);
  let fileNfts = [];
  try { fileNfts = await loadCollectionMetadata(); } catch {}
  let nfts;
  if (apiNfts && apiNfts.length) {
    const existingNames = new Set(apiNfts.map(n => n.name));
    const merged = apiNfts.concat(fileNfts.filter(f => f && f.name && !existingNames.has(f.name)));
    nfts = merged;
    logger.info(`Loaded ${apiNfts.length} NFT(s) from API, ${fileNfts.length} from file, merged total ${nfts.length}.`);
  } else if (fileNfts.length) {
    nfts = fileNfts;
    logger.info(`Loaded ${fileNfts.length} NFT(s) from file.`);
  } else {
    logger.error('No NFT metadata sources available (API/file). Exiting.');
    process.exit(1);
  }
  const force = process.argv.includes('--force');
  let success = 0;
  for (const nft of nfts) {
    try {
      await upsertAvatarFromNft(nft, { force });
      success++;
    } catch (e) {
      logger.error(`Failed processing NFT '${nft?.name}': ${e.message}`);
    }
  }
  logger.info(`NFT avatar sync complete. Processed ${success}/${nfts.length}.`);
  process.exit(0);
}

main().catch(err => { logger.error('Fatal sync error: ' + err.message); process.exit(1); });
