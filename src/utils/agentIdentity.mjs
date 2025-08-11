/**
 * Agent Identity & Hash Utilities
 * Deterministic agent_id:
 *   agent_id = keccak256(chain_id || origin_contract || token_id)
 * Each component left‑padded to 32 bytes (hex) before concatenation (no 0x between parts).
 * For non‑hex contracts (e.g. Solana mints) we hash the string to 32 bytes first.
 */
import pkg from 'js-sha3';
const { keccak_256 } = pkg;

const CHAIN_ID_MAP = {
  ethereum: 1,
  mainnet: 1,
  base: 8453,
  polygon: 137,
  matic: 137,
  solana: 0x534f4c41 // synthetic (ASCII 'SOLA') until native mapping.
};

export function resolveChainId(chainName, explicit) {
  if (explicit !== undefined && explicit !== null && !Number.isNaN(Number(explicit))) return Number(explicit);
  if (!chainName) return 1;
  return CHAIN_ID_MAP[String(chainName).toLowerCase()] || 1;
}

function leftPad32(hex) {
  return hex.replace(/^0x/, '').padStart(64, '0');
}

function normalizeContract(contract) {
  if (!contract) return '0x' + '0'.repeat(64);
  if (!/^0x[0-9a-fA-F]+$/.test(contract)) {
    // Hash arbitrary identifier (e.g. base58) to 32 bytes.
    return '0x' + keccak_256(contract);
  }
  const lower = contract.toLowerCase();
  if (lower.length === 42) return lower; // 20 bytes
  return '0x' + lower.replace(/^0x/, '').padStart(40, '0');
}

export function normalizeTokenId(tokenId) {
  if (tokenId === undefined || tokenId === null) throw new Error('tokenId required');
  if (typeof tokenId === 'bigint') return tokenId;
  const s = String(tokenId);
  if (/^\d+$/.test(s)) return BigInt(s);
  if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
  // Hash arbitrary token identifiers (e.g., base58 or UUID) and take 8 bytes for BigInt
  return BigInt('0x' + keccak_256(s).slice(0, 16));
}

export function computeAgentId({ chainId, originContract, tokenId }) {
  if (tokenId === undefined || tokenId === null) throw new Error('tokenId required');
  tokenId = normalizeTokenId(tokenId);
  const chainPart = leftPad32('0x' + BigInt(chainId).toString(16));
  const contractNorm = normalizeContract(originContract);
  const contractPart = leftPad32(contractNorm);
  const tokenPart = leftPad32('0x' + BigInt(tokenId).toString(16));
  const preimage = chainPart + contractPart + tokenPart; // hex string (no 0x)
  const hash = keccak_256(Buffer.from(preimage, 'hex'));
  return '0x' + hash;
}

// Canonical JSON serialization (sorted keys) – no whitespace, numbers converted to strings.
export function canonicalSerialize(obj) {
  function ser(v) {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
    if (typeof v === 'object') {
      const keys = Object.keys(v).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + ser(v[k])).join(',') + '}';
    }
    if (typeof v === 'number') return JSON.stringify(String(v));
    return JSON.stringify(v);
  }
  return ser(obj);
}

export function computeBlockHash(blockCore) {
  const canon = canonicalSerialize(blockCore);
  return '0x' + keccak_256(canon);
}

export function buildBlock({ previous, core }) {
  const base = { ...core };
  if (previous) {
    base.index = previous.index + 1;
    base.parent_hash = previous.block_hash;
  } else {
    base.index = 0;
    base.parent_hash = null;
  }
  const { block_hash: _block_hash, ...withoutHash } = base; // ensure no accidental field
  base.block_hash = computeBlockHash(withoutHash);
  return base;
}

export default { computeAgentId, resolveChainId, canonicalSerialize, computeBlockHash, buildBlock, normalizeTokenId };
