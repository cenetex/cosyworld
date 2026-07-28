import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PublicKey } from "@solana/web3.js";

export const MPL_CORE_PROGRAM_ID =
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

const ASSET_V1_KEY = 1;
const COLLECTION_V1_KEY = 5;
const MAX_NAME_BYTES = 256;
const MAX_URI_BYTES = 2048;
const MAX_METADATA_BYTES = 256 * 1024;
const ALLOWED_TRAITS = new Map(
  [
    "Coordinator",
    "Background",
    "Bottom",
    "Eye",
    "Hair",
    "Headwear",
    "Skin",
    "Top",
  ].map((name) => [name.toLowerCase(), name]),
);

class BufferCursor {
  constructor(buffer) {
    this.buffer = Buffer.from(buffer);
    this.offset = 0;
  }

  take(length, label) {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`${label} has an invalid length`);
    }
    if (this.offset + length > this.buffer.length) {
      throw new Error(`${label} extends past the account boundary`);
    }
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  u8(label) {
    return this.take(1, label)[0];
  }

  u32(label) {
    return this.take(4, label).readUInt32LE(0);
  }

  publicKey(label) {
    return new PublicKey(this.take(32, label)).toBase58();
  }

  string(label, maximumBytes) {
    const length = this.u32(`${label} length`);
    if (length > maximumBytes) {
      throw new Error(`${label} exceeds ${maximumBytes} bytes`);
    }
    return this.take(length, label).toString("utf8");
  }
}

function parseUpdateAuthority(cursor) {
  const variant = cursor.u8("update authority variant");
  if (variant === 0) return { type: "None", address: null };
  if (variant === 1) {
    return { type: "Address", address: cursor.publicKey("update authority") };
  }
  if (variant === 2) {
    return { type: "Collection", address: cursor.publicKey("collection") };
  }
  throw new Error(`unsupported update authority variant ${variant}`);
}

function assertHttpsUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  return url.toString();
}

function cleanText(value, maximumLength = 1024) {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maximumLength) : null;
}

export function chooseCandidateProfile(assetAddress, metadata) {
  const text = [
    metadata.description,
    metadata.voice_seed,
    ...Object.values(metadata.cosmetic_traits),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let suggestedRole = null;
  if (/\b(signal|frequenc|listen|headphone|decod|system)/.test(text)) {
    suggestedRole = "Signal Weaver";
  } else if (/\b(memor|archive|remember|testimon)/.test(text)) {
    suggestedRole = "Memory Diver";
  } else if (/\b(protect|anchor|stabili|shield)/.test(text)) {
    suggestedRole = "Reality Anchor";
  } else if (/\b(connect|alliance|relation|empath|diploma)/.test(text)) {
    suggestedRole = "Bridge Envoy";
  } else if (/\b(strength|break|force|combat)/.test(text)) {
    suggestedRole = "Chimera Breaker";
  } else if (/\b(scout|stealth|infiltrat|route)/.test(text)) {
    suggestedRole = "Echo Runner";
  }

  let suggestedDrive = null;
  if (/\b(connect|relation|alliance|loom)/.test(text)) {
    suggestedDrive = "Connect";
  } else if (/\b(memor|remember|archive|testimon)/.test(text)) {
    suggestedDrive = "Remember";
  } else if (/\b(repair|restor|mend|stabili)/.test(text)) {
    suggestedDrive = "Repair";
  } else if (/\b(reveal|evidence|truth|expos)/.test(text)) {
    suggestedDrive = "Reveal";
  } else if (/\b(liberat|rescu|free|escape)/.test(text)) {
    suggestedDrive = "Liberate";
  }

  const seed = createHash("sha256").update(assetAddress).digest();
  const roles = [
    "Echo Runner",
    "Signal Weaver",
    "Memory Diver",
    "Reality Anchor",
    "Bridge Envoy",
    "Chimera Breaker",
  ];
  const drives = ["Liberate", "Remember", "Connect", "Repair", "Reveal"];

  return {
    profile_version: "project89-profile/1",
    suggested_role: suggestedRole ?? roles[seed[0] % roles.length],
    suggested_drive: suggestedDrive ?? drives[seed[1] % drives.length],
    suggestion_is_mechanical_authority: false,
  };
}

export function parseCoreAssetAccount(buffer) {
  const cursor = new BufferCursor(buffer);
  const key = cursor.u8("account key");
  if (key !== ASSET_V1_KEY) {
    throw new Error(`expected AssetV1 key ${ASSET_V1_KEY}, received ${key}`);
  }
  return {
    account_kind: "metaplex_core_asset_v1",
    owner: cursor.publicKey("asset owner"),
    update_authority: parseUpdateAuthority(cursor),
    name: cursor.string("asset name", MAX_NAME_BYTES),
    metadata_uri: assertHttpsUrl(
      cursor.string("asset metadata URI", MAX_URI_BYTES),
      "asset metadata URI",
    ),
  };
}

export function parseCoreCollectionAccount(buffer) {
  const cursor = new BufferCursor(buffer);
  const key = cursor.u8("account key");
  if (key !== COLLECTION_V1_KEY) {
    throw new Error(
      `expected CollectionV1 key ${COLLECTION_V1_KEY}, received ${key}`,
    );
  }
  return {
    account_kind: "metaplex_core_collection_v1",
    update_authority: cursor.publicKey("collection update authority"),
    name: cursor.string("collection name", MAX_NAME_BYTES),
    metadata_uri: assertHttpsUrl(
      cursor.string("collection metadata URI", MAX_URI_BYTES),
      "collection metadata URI",
    ),
    num_minted: cursor.u32("collection minted count"),
    current_size: cursor.u32("collection current size"),
  };
}

export function normalizeProxim8Metadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("metadata must be an object");
  }

  const cosmeticTraits = {};
  for (const attribute of Array.isArray(metadata.attributes)
    ? metadata.attributes
    : []) {
    const traitName = cleanText(attribute?.trait_type, 64);
    const traitValue = cleanText(attribute?.value, 512);
    if (!traitName || !traitValue) continue;

    if (traitName.toLowerCase() === "personality") continue;
    const canonicalName = ALLOWED_TRAITS.get(traitName.toLowerCase());
    if (canonicalName) cosmeticTraits[canonicalName] = traitValue;
  }

  const personalityAttribute = (
    Array.isArray(metadata.attributes) ? metadata.attributes : []
  ).find(
    (attribute) =>
      cleanText(attribute?.trait_type, 64)?.toLowerCase() === "personality",
  );

  return {
    token_id: cleanText(metadata.tokenId, 128),
    name: cleanText(metadata.name, 128),
    description: cleanText(metadata.description, 2048),
    cosmetic_traits: cosmeticTraits,
    voice_seed: cleanText(personalityAttribute?.value, 2048),
    image: assertHttpsUrl(metadata.image, "metadata image"),
    mechanics_from_metadata: false,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_METADATA_BYTES) {
    throw new Error(`${url} exceeds ${MAX_METADATA_BYTES} bytes`);
  }
  return JSON.parse(bytes.toString("utf8"));
}

export async function inspectProxim8({
  collectionAddress,
  assetAddress,
  rpcUrl = "https://api.mainnet-beta.solana.com",
}) {
  new PublicKey(collectionAddress);
  new PublicKey(assetAddress);
  const rpc = await fetchJson(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getMultipleAccounts",
      params: [
        [collectionAddress, assetAddress],
        { encoding: "base64", commitment: "confirmed" },
      ],
    }),
  });
  if (rpc.error) throw new Error(`Solana RPC: ${rpc.error.message}`);
  const [collectionAccount, assetAccount] = rpc.result?.value ?? [];
  if (!collectionAccount || !assetAccount) {
    throw new Error("collection or asset account does not exist");
  }
  if (
    collectionAccount.owner !== MPL_CORE_PROGRAM_ID ||
    assetAccount.owner !== MPL_CORE_PROGRAM_ID
  ) {
    throw new Error("collection and asset must both be owned by MPL Core");
  }

  const collection = parseCoreCollectionAccount(
    Buffer.from(collectionAccount.data[0], "base64"),
  );
  const asset = parseCoreAssetAccount(
    Buffer.from(assetAccount.data[0], "base64"),
  );
  if (
    asset.update_authority.type !== "Collection" ||
    asset.update_authority.address !== collectionAddress
  ) {
    throw new Error(
      "asset is not a verified member of the expected collection",
    );
  }

  const metadata = normalizeProxim8Metadata(
    await fetchJson(asset.metadata_uri),
  );
  return {
    fixture_version: "project89-proxim8/1",
    network: "solana/mainnet-beta",
    identity_key: `solana/mainnet-beta/${collectionAddress}/${assetAddress}`,
    collection: { address: collectionAddress, ...collection },
    asset: { address: assetAddress, ...asset },
    metadata,
    candidate_profile: chooseCandidateProfile(assetAddress, metadata),
  };
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(process.argv[1], "file:"));

if (isMain) {
  const collectionAddress = readArgument("--collection");
  const assetAddress = readArgument("--asset");
  const rpcUrl = readArgument("--rpc") ?? "https://api.mainnet-beta.solana.com";
  if (!collectionAddress || !assetAddress) {
    console.error(
      "Usage: node v2/scripts/inspect-project89-proxim8.mjs --collection <address> --asset <address> [--rpc <url>]",
    );
    process.exitCode = 2;
  } else {
    inspectProxim8({ collectionAddress, assetAddress, rpcUrl })
      .then((fixture) => console.log(JSON.stringify(fixture, null, 2)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
