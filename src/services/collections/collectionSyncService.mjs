/**
 * Collection Sync Service: reusable sync for NFT-derived avatars.
 */
import 'dotenv/config';
import { container } from '../../container.mjs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import pkg from 'js-sha3';
import { buildAvatarGuildMatch, buildCollectionConfigScopeQuery, normalizeGuildId } from '../../utils/guildScope.mjs';

// Lazy helpers to avoid resolving before container is ready
const getLogger = () => {
  try { return container.resolve('logger'); } catch { return console; }
};
const getDBService = () => container.resolve('databaseService');
const getAIService = () => {
  try {
    const pref = String(process.env.AI_SERVICE || '').toLowerCase();
    if (pref === 'google') return container.resolve('googleAIService');
    if (pref === 'openrouter') return container.resolve('openrouterAIService');
    if (pref === 'ollama') return container.resolve('ollamaAIService');
    if (pref === 'replicate') return container.resolve('replicateAIService');
    // Fallbacks
    if (container.registrations.aiService) return container.resolve('aiService');
    // Try common names if no explicit preference
    for (const name of ['openrouterAIService','googleAIService','ollamaAIService','replicateAIService']) {
      if (container.registrations[name]) return container.resolve(name);
    }
    return null;
  } catch {
    return null;
  }
};
async function getIdentityFns() {
  try {
    const idMod = await import('../../utils/agentIdentity.mjs');
    return { computeAgentId: idMod.computeAgentId, resolveChainId: idMod.resolveChainId };
  } catch {
    return { computeAgentId: null, resolveChainId: null };
  }
}

function normIpfs(url) {
  if (!url || typeof url !== 'string') return '';
  return url.replace(/^ipfs:\/\//i, 'https://ipfs.io/ipfs/');
}

function resolveImageUrl(nft) {
  if (!nft) return '';
  const candidates = [];
  const pushCandidate = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      candidates.push(value);
      return;
    }
    if (typeof value === 'object') {
      const maybe = [
        value.cdnUrl,
        value.sourceUrl,
        value.url,
        value.uri,
        value.href,
        value.original,
        value.src,
      ];
      for (const v of maybe) {
        if (typeof v === 'string') {
          candidates.push(v);
        }
      }
    }
  };

  pushCandidate(nft.image);
  pushCandidate(nft.image_url);
  pushCandidate(nft.imageUrl);
  pushCandidate(nft.media);
  pushCandidate(nft.media?.image);
  pushCandidate(nft.media?.url);
  pushCandidate(nft.media?.uri);
  pushCandidate(nft.content?.uri);
  pushCandidate(nft.content?.url);

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = normIpfs(candidate.trim());
    if (normalized) return normalized;
  }
  return '';
}

function identityFromNft(nft) {
  const token = nft.token_id || nft.tokenId || nft.mint || nft.id || '';
  const key = token ? String(token).toLowerCase() : '';
  if (key) return `token:${key}`;
  const name = (nft.name || '').trim().toLowerCase();
  const img = resolveImageUrl(nft).toLowerCase();
  return `name:${name}|img:${img}`;
}

function dedupeNfts(preferredFirst, fallbackList) {
  const map = new Map();
  for (const n of preferredFirst || []) {
    const id = identityFromNft(n);
    if (!map.has(id)) map.set(id, n);
  }
  for (const n of fallbackList || []) {
    const id = identityFromNft(n);
    if (!map.has(id)) map.set(id, n);
  }
  return Array.from(map.values());
}

async function loadCollectionMetadata({ collectionId, fileSource }) {
  const src = fileSource || path.join(process.cwd(), 'data', `${collectionId}.json`);
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('Remote JSON must be an array');
    return json;
  }
  const raw = await fs.readFile(src, 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.tokens)) {
    return data.tokens;
  }
  throw new Error('Collection JSON must be an array of NFT metadata objects');
}

async function fetchFromReservoir({ apiKey, collection }) {
  if (!apiKey) throw new Error('Reservoir API key required');
  const base = 'https://api.reservoir.tools';
  const tokens = [];
  let continuation = null;
  do {
    const url = new URL(base + '/tokens/v7');
    url.searchParams.set('collection', collection);
    url.searchParams.set('limit', '1000');
    url.searchParams.set('includeAttributes', 'true');
    if (continuation) url.searchParams.set('continuation', continuation);
    const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) throw new Error(`Reservoir HTTP ${res.status}`);
    const data = await res.json();
    for (const t of data.tokens || []) {
      const token = t.token || {};
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

async function fetchFromOpenSea({ apiKey, collection, chain }) {
  if (!apiKey) throw new Error('OpenSea API key required');
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(collection);
  const tokens = [];
  let next = null;
  let page = 0;
  do {
    page++;
    let url;
    if (isAddress) {
      url = new URL(`https://api.opensea.io/api/v2/chain/${chain}/contract/${collection}/nfts`);
    } else {
      url = new URL(`https://api.opensea.io/api/v2/collections/${collection}/nfts`);
    }
    url.searchParams.set('limit', '50');
    if (next) url.searchParams.set('next', next);
    const res = await fetch(url, { headers: { 'X-API-KEY': apiKey } });
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
    if (page > 200) break;
  } while (next);
  return tokens;
}

async function fetchFromAlchemy({ apiKey, collection, chain }) {
  if (!apiKey) throw new Error('Alchemy API key required');
  if (!/^0x[a-fA-F0-9]{40}$/.test(collection)) throw new Error('Alchemy requires contract address');
  const host = chain.includes('base') ? 'base-mainnet.g.alchemy.com' : chain.includes('polygon') ? 'polygon-mainnet.g.alchemy.com' : 'eth-mainnet.g.alchemy.com';
  let startToken = null;
  const tokens = [];
  let loops = 0;
  do {
    loops++;
    const url = new URL(`https://${host}/nft/v3/${apiKey}/getNFTsForCollection`);
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
        image: normIpfs(meta.image),
        attributes: (meta.attributes || []).map(a => ({ trait_type: a.trait_type || a.key, value: a.value }))
      });
    }
    startToken = data.nextToken || null;
    if (loops > 500) break;
  } while (startToken);
  return tokens;
}

async function fetchFromHelius({ apiKey, collection }) {
  if (!apiKey) throw new Error('Helius API key required');
  const endpoint = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  async function rpc(method, params) {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now().toString(), method, params });
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type':'application/json' }, body });
    if (!res.ok) throw new Error(`Helius RPC HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`Helius RPC error (${method}): ${json.error.message || json.error}`);
    return json.result;
  }
  const tokens = [];
  try {
    let page = 1; const limit = 100;
    while (true) {
      const result = await rpc('getAssetsByCreator', { creatorAddress: collection, page, limit });
      const items = result?.items || [];
      if (!items.length) break;
      for (const it of items) {
        const meta = it?.content?.metadata || it?.content?.json || it?.content || {};
        const name = meta.name || it?.name; if (!name) continue;
        const image = normIpfs(meta.image || it?.content?.files?.[0]?.uri || '');
        const attrs = meta.attributes || meta.traits || [];
        const normalizedAttrs = Array.isArray(attrs)
          ? attrs.map(a => ({ trait_type: a.trait_type || a.traitType || a.key, value: a.value }))
          : Object.entries(attrs || {}).map(([k,v]) => ({ trait_type: k, value: v }));
        tokens.push({ id: it.id, mint: it.id, name, description: meta.description, image, attributes: normalizedAttrs });
      }
      if (items.length < limit) break;
      page++; if (page > 50) break;
    }
    if (tokens.length) return tokens;
  } catch {}
  try {
    let page = 1; const limit = 100;
    while (true) {
      const result = await rpc('getAssetsByGroup', { groupKey: 'collection', groupValue: collection, page, limit });
      const items = result?.items || [];
      if (!items.length) break;
      for (const it of items) {
        const meta = it?.content?.metadata || it?.content?.json || it?.content || {};
        const name = meta.name || it?.name; if (!name) continue;
        const image = normIpfs(meta.image || it?.content?.files?.[0]?.uri || '');
        const attrs = meta.attributes || meta.traits || [];
        const normalizedAttrs = Array.isArray(attrs)
          ? attrs.map(a => ({ trait_type: a.trait_type || a.traitType || a.key, value: a.value }))
          : Object.entries(attrs || {}).map(([k,v]) => ({ trait_type: k, value: v }));
        tokens.push({ id: it.id, mint: it.id, name, description: meta.description, image, attributes: normalizedAttrs });
      }
      if (items.length < limit) break;
      page++; if (page > 50) break;
    }
  } catch {}
  return tokens;
}

async function fetchCollectionViaApi({ provider, apiKey, collection, chain }) {
  const p = (provider || '').toLowerCase();
  if (!p) return null;
  if (p === 'reservoir') return await fetchFromReservoir({ apiKey, collection });
  if (p === 'opensea') return await fetchFromOpenSea({ apiKey, collection, chain });
  if (p === 'alchemy') return await fetchFromAlchemy({ apiKey, collection, chain });
  if (p === 'helius' || chain === 'solana') return await fetchFromHelius({ apiKey, collection });
  getLogger().warn(`Unknown NFT provider '${provider}'.`);
  return null;
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
    for (const [k,v] of Object.entries(attrs)) traitEntries.push(`${k}: ${v}`);
  }
  return traitEntries.join('\n');
}

async function synthesizeDynamicPersonality(baseDescription, providedPersonality, traitSummary, coordinator) {
  const prompt = `You are enriching an avatar personality.\nBase Description:\n${baseDescription}\n\nProvided Personality (optional):\n${providedPersonality || 'N/A'}\n\nTraits:\n${traitSummary}\n\nCoordinator / Faction: ${coordinator || 'Unknown'}\n\nTask: Combine these into an in-universe first-person style dynamic internal monologue (120-200 words).`;
  const aiService = getAIService();
  if (!aiService?.chat) return providedPersonality || baseDescription;
  try {
    const response = await aiService.chat([
      { role: 'system', content: 'You craft nuanced RPG character internal voices.' },
      { role: 'user', content: prompt }
    ]);
    return response;
  } catch (e) {
    getLogger().warn('Failed to synthesize dynamic personality: ' + e.message);
    return providedPersonality || baseDescription;
  }
}

async function upsertAvatarFromNft(nft, ctx) {
  const { collectionId, chain, provider, force: _force, guildId: rawGuildId } = ctx;
  const guildId = normalizeGuildId(rawGuildId);
  const databaseService = getDBService();
  const db = await databaseService.getDatabase();
  const avatarsCol = db.collection('avatars');

  const name = (nft.name || '').trim();
  if (!name) {
    getLogger().warn('Skipping NFT with no name.');
    return null;
  }

  const tokenKey = nft.token_id || nft.tokenId || nft.mint || nft.id || null;
  const baseQuery = tokenKey
    ? { 'nft.collection': collectionId, 'nft.tokenId': tokenKey }
    : { name, 'nft.collection': collectionId };
  const guildMatch = buildAvatarGuildMatch(guildId);
  const query = { ...baseQuery, ...guildMatch };

  const description = nft.description?.trim() || 'A mysterious entity.';
  const providedPersonality = nft.personality?.trim() || nft.attributes?.Personality || null;
  const traitSummary = buildTraitSummary(nft);
  const coordinator = nft.attributes?.Coordinator || nft.attributes?.Faction || null;
  const dynamicPersonality = await synthesizeDynamicPersonality(description, providedPersonality, traitSummary, coordinator);

  const aiSvc = getAIService();

  const rawImageUrl = resolveImageUrl(nft);
  let imageUrl = rawImageUrl;
  try {
    if (rawImageUrl && /^https?:\/\//i.test(rawImageUrl)) {
      const s3Service = container.resolve('s3Service');
      const buf = await s3Service.downloadImage(rawImageUrl).catch(() => null);
      if (buf) {
        const ext = rawImageUrl.split('?')[0].split('.').pop().toLowerCase();
        const valid = ['png', 'jpg', 'jpeg', 'gif'];
        const useExt = valid.includes(ext) ? ext : 'png';
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nft-'));
        const tmpFile = path.join(tmpDir, `img.${useExt}`);
        await fs.writeFile(tmpFile, buf);
        const uploaded = await s3Service.uploadImage(tmpFile).catch(() => null);
        if (uploaded) imageUrl = uploaded;
      }
    }
  } catch (e) {
    getLogger().warn(`Rehosting failed for ${rawImageUrl}: ${e.message}`);
  }

  let agentId = null;
  let chainId;
  let originContract;
  try {
    const { computeAgentId, resolveChainId } = await getIdentityFns();
    if (computeAgentId && resolveChainId) {
      const explicitChainId = process.env.NFT_CHAIN_ID ? Number(process.env.NFT_CHAIN_ID) : undefined;
      chainId = resolveChainId(chain, explicitChainId);
      originContract = collectionId;
      const rawToken = nft.token_id || nft.tokenId || nft.mint || nft.id || null;
      let tokenNumeric = null;
      if (rawToken && /^\d+$/.test(String(rawToken))) tokenNumeric = BigInt(rawToken);
      else if (rawToken && /^0x[0-9a-fA-F]+$/.test(String(rawToken))) tokenNumeric = BigInt(rawToken);
      else if (rawToken) tokenNumeric = BigInt(`0x${pkg.keccak_256(rawToken).slice(0, 16)}`);
      if (tokenNumeric != null) agentId = computeAgentId({ chainId, originContract, tokenId: tokenNumeric });
    }
  } catch {}

  const now = new Date();
  const nftMetadata = {
    collection: collectionId,
    tokenId: tokenKey || null,
    chain: chain === 'solana' ? 'solana' : (chain || 'ethereum'),
    originalImageUrl: rawImageUrl,
    provider: provider || null,
    fetchedAt: now,
  };

  const setFields = {
    name,
    description,
    personality: providedPersonality || 'Reserved yet undefined.',
    dynamicPersonality,
    emoji: nft.emoji || '🫬',
    model: await aiSvc?.getModel?.(nft.model || ''),
    imageUrl,
    source: 'nft-sync',
    nft: nftMetadata,
    agentId: agentId || null,
    traits: nft.attributes || nft.traits || [],
    updatedAt: now,
    guildId: guildId || null,
  };

  if (agentId && chainId) {
    setFields.chainId = chainId;
    setFields.originContract = originContract;
  }

  const setOnInsert = {
    createdAt: now,
    status: 'alive',
    channelId: null,
    lives: 3,
  };

  try {
    const result = await avatarsCol.findOneAndUpdate(
      query,
      { $set: setFields, $setOnInsert: setOnInsert },
      { upsert: true, returnDocument: 'after' }
    );
    return result.value;
  } catch (error) {
    if (error?.code === 11000) {
      throw new Error('NFT avatar already exists for another guild scope');
    }
    throw error;
  }
}

export async function syncAvatarsForCollection({
  collectionId,
  provider = process.env.NFT_API_PROVIDER || '',
  apiKey = process.env.NFT_API_KEY || process.env.RESERVOIR_API_KEY || process.env.OPENSEA_API_KEY || process.env.ALCHEMY_API_KEY || process.env.HELIUS_API_KEY,
  chain = (process.env.NFT_CHAIN || 'ethereum').toLowerCase(),
  fileSource,
  force = false,
  guildId = null,
}, progressReporter = null) {
  if (!collectionId) throw new Error('collectionId required');
  const databaseService = getDBService();
  await databaseService.getDatabase();

  const normalizedGuildId = normalizeGuildId(guildId);

  let apiNfts = null;
  try {
    apiNfts = await fetchCollectionViaApi({ provider, apiKey, collection: collectionId, chain });
  } catch (e) {
    getLogger().error(`API fetch failed: ${e.message}`);
  }
  let fileNfts = [];
  if (fileSource) {
    try { fileNfts = await loadCollectionMetadata({ collectionId, fileSource }); } catch {}
  } else {
    try { fileNfts = await loadCollectionMetadata({ collectionId }); } catch {}
  }

  let nfts;
  if (apiNfts && apiNfts.length) {
    nfts = dedupeNfts(apiNfts, fileNfts);
  } else if (fileNfts.length) {
    nfts = dedupeNfts(fileNfts, []);
  } else {
    throw new Error('No NFT metadata sources available (API/file)');
  }

  // Notify UI of total to enable percentage rendering
  if (typeof progressReporter === 'function') {
    try {
      await progressReporter({
        collectionId,
        guildId: normalizedGuildId,
        total: (apiNfts && apiNfts.length) ? apiNfts.length : (fileNfts?.length || 0),
        startedAt: new Date(),
      });
    } catch {}
  }
  let success = 0, failures = 0;
  let processed = 0;
  for (const nft of nfts) {
    try {
      await upsertAvatarFromNft(nft, { collectionId, chain, provider, force, guildId: normalizedGuildId });
      processed++; success++;
      if (typeof progressReporter === 'function') {
        try { await progressReporter({ collectionId, processed, success, failures, nft, guildId: normalizedGuildId }); } catch {}
      }
    } catch (e) {
      processed++; failures++;
      getLogger().error(`Failed processing NFT '${nft?.name}': ${e.message}`);
      if (typeof progressReporter === 'function') {
        try { await progressReporter({ collectionId, processed, success, failures, nft, error: e.message, guildId: normalizedGuildId }); } catch {}
      }
    }
  }
  return { processed: nfts.length, success, failures };
}

/**
 * Try to sync a specific avatar by name from configured collections
 * @param {string} avatarName - The name to search for
 * @returns {Promise<object|null>} The synced avatar document or null if not found
 */
export async function syncAvatarByNameFromCollections(avatarName, guildId = null) {
  if (!avatarName) return null;
  const logger = getLogger();
  const normalizedGuildId = normalizeGuildId(guildId);
  
  try {
    const databaseService = getDBService();
    const db = await databaseService.getDatabase();
    
    // Check if there are any configured collections
    const configFilter = normalizedGuildId
      ? buildCollectionConfigScopeQuery(normalizedGuildId)
      : buildCollectionConfigScopeQuery(null, { matchAllWhenMissing: false });
    const configs = await db.collection('collection_configs').find(configFilter).toArray();
    if (!configs || configs.length === 0) {
      logger.debug?.('No collection configs found for avatar sync');
      return null;
    }
    
    // Try each collection to find a matching avatar
    for (const cfg of configs) {
      try {
  const provider = cfg.provider || process.env.NFT_API_PROVIDER || '';
        const apiKey = process.env.NFT_API_KEY || process.env.RESERVOIR_API_KEY || process.env.OPENSEA_API_KEY || process.env.ALCHEMY_API_KEY || process.env.HELIUS_API_KEY;
        const chain = (cfg.chain || process.env.NFT_CHAIN || 'ethereum').toLowerCase();
        const fileSource = (cfg.sync?.source?.includes('file') && cfg.sync?.fileSource) ? cfg.sync.fileSource : undefined;
  const cfgGuildId = normalizeGuildId(cfg.guildId ?? normalizedGuildId ?? null);
        
        // Try to load collection metadata
        let nfts = [];
        
        // Try API first
        try {
          const apiNfts = await fetchCollectionViaApi({ provider, apiKey, collection: cfg.key, chain });
          if (apiNfts && apiNfts.length) nfts = apiNfts;
        } catch (e) {
          logger.debug?.(`API fetch failed for ${cfg.key}: ${e.message}`);
        }
        
        // Fallback to file if no API results
        if (nfts.length === 0 && fileSource) {
          try {
            nfts = await loadCollectionMetadata({ collectionId: cfg.key, fileSource });
          } catch (e) {
            logger.debug?.(`File load failed for ${cfg.key}: ${e.message}`);
          }
        }
        
        // Try default file location if still no results
        if (nfts.length === 0) {
          try {
            nfts = await loadCollectionMetadata({ collectionId: cfg.key });
          } catch (e) {
            logger.debug?.(`Default file load failed for ${cfg.key}: ${e.message}`);
          }
        }
        
        // Search for matching NFT by name (case-insensitive)
        const matchingNft = nfts.find(nft => 
          nft.name && nft.name.toLowerCase() === avatarName.toLowerCase()
        );
        
        if (matchingNft) {
          logger.info?.(`Found ${avatarName} in collection ${cfg.key}, syncing...`);
          
          // Sync this specific avatar (force=false to preserve existing data)
          const avatar = await upsertAvatarFromNft(matchingNft, {
            collectionId: cfg.key,
            chain,
            provider,
            force: false,
            guildId: cfgGuildId,
          });
          
          if (avatar) {
            logger.info?.(`Successfully synced ${avatarName} from collection ${cfg.key}`);
            return avatar;
          }
        }
      } catch (e) {
        logger.warn?.(`Error checking collection ${cfg.key} for ${avatarName}: ${e.message}`);
        // Continue to next collection
      }
    }
    
    logger.debug?.(`Avatar ${avatarName} not found in any configured collection`);
    return null;
  } catch (e) {
    logger.error?.(`Error in syncAvatarByNameFromCollections: ${e.message}`);
    return null;
  }
}

export default { syncAvatarsForCollection, syncAvatarByNameFromCollections };

