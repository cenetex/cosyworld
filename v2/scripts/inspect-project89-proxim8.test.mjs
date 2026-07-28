import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseCandidateProfile,
  normalizeProxim8Metadata,
  parseCoreAssetAccount,
  parseCoreCollectionAccount,
} from "./inspect-project89-proxim8.mjs";

const COLLECTION_ACCOUNT_BASE64 =
  "BWwXjMTlCvfefV8zkwdihBGdN9vqqu8e/nZVOLGNfL50BwAAAFBST1hJTThOAAAAaHR0cHM6Ly9nYXRld2F5LnBpbml0LmlvL2lwZnMvUW1XUTRtbldGd3N5TjhHYUw5RHBiaWluNDU4YmtNYmI0Q3hjMXc2SzdudzhNUy8wugYAALIGAAAD4AAAAAAAAAAAhAMCAAAAbBeMxOUK9959XzOTB2KEEZ032+qq7x7+dlU4sY18vnRZzgCEQkOwdRl8onF1pKnR5dvQaRzIpZ2moHmvDZChxnALAAUABAAAAAAEAwAAAAACjwAAAAAAAAAFA/Vqp8/0u+7HSzb4U6JKYgoVaNljV89LvtGNrrUsejwL2QAAAAAAAAAEA/Vqp8/0u+7HSzb4U6JKYgoVaNljV89LvtGNrrUsejwL2wAAAAAAAAAAAAAA";
const ASSET_ACCOUNT_BASE64 =
  "AbtmkmAOqIZnFRbWFbs1SjVWmFPyGUligiJDtbtRLvhFAkFfKjbRwDK/ahYAOtuZ5CSx3AV0W/OWpLpvRG0LTHTYEAAAAENhbGx1bSBTeW5jbGFpcmVWAAAAaHR0cHM6Ly9nYXRld2F5LnBpbml0LmlvL2lwZnMvUW1RVURkSjFuaXlEeDRhR01Ka2VzUW1TSmhpQnEyVFpabmU1TEJUVnNwaFk2Ti8xNjU2Lmpzb24A";

test("parses the live PROXIM8 Core collection base fields", () => {
  const collection = parseCoreCollectionAccount(
    Buffer.from(COLLECTION_ACCOUNT_BASE64, "base64"),
  );
  assert.deepEqual(collection, {
    account_kind: "metaplex_core_collection_v1",
    update_authority: "8GwrpeSH4TpAGEJsmoF35J8DY6RNCdyjCBZsEnTySEKd",
    name: "PROXIM8",
    metadata_uri:
      "https://gateway.pinit.io/ipfs/QmWQ4mnWFwsyN8GaL9Dpbiin458bkMbb4Cxc1w6K7nw8MS/0",
    num_minted: 1722,
    current_size: 1714,
  });
});

test("parses Callum as a collection-backed Core asset", () => {
  const asset = parseCoreAssetAccount(
    Buffer.from(ASSET_ACCOUNT_BASE64, "base64"),
  );
  assert.deepEqual(asset, {
    account_kind: "metaplex_core_asset_v1",
    owner: "DcXxMstZHwnEMjLTF1Aa2kHB95NBif77nPUEZqD4ZTue",
    update_authority: {
      type: "Collection",
      address: "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf",
    },
    name: "Callum Synclaire",
    metadata_uri:
      "https://gateway.pinit.io/ipfs/QmQUDdJ1niyDx4aGMJkesQmSJhiBq2TZZne5LBTVsphY6N/1656.json",
  });
});

test("keeps traits cosmetic and separates personality as an untrusted seed", () => {
  const normalized = normalizeProxim8Metadata({
    tokenId: "3759",
    name: "Callum Synclaire",
    description: "Listens for authentic connection.",
    image: "https://example.invalid/callum.jpg",
    attributes: [
      { trait_type: "Personality", value: "Quiet intensity." },
      { trait_type: "Coordinator", value: "Iris" },
      { trait_type: "Eye", value: "Ember" },
      { trait_type: "Attack Bonus", value: "+999" },
    ],
  });

  assert.deepEqual(normalized.cosmetic_traits, {
    Coordinator: "Iris",
    Eye: "Ember",
  });
  assert.equal(normalized.voice_seed, "Quiet intensity.");
  assert.equal(normalized.mechanics_from_metadata, false);
  assert.equal("Attack Bonus" in normalized.cosmetic_traits, false);
});

test("rejects a non-HTTPS metadata image", () => {
  assert.throws(
    () =>
      normalizeProxim8Metadata({
        name: "Unsafe",
        image: "javascript:alert(1)",
      }),
    /must use HTTPS/,
  );
});

test("maps Callum to the Signal Weaver and Connect candidate", () => {
  const candidate = chooseCandidateProfile(
    "Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo",
    {
      description:
        "Listens through large headphones for frequencies and authentic connection.",
      voice_seed: "Weaves understanding into the Green Loom.",
      cosmetic_traits: { Coordinator: "Iris" },
    },
  );
  assert.deepEqual(candidate, {
    profile_version: "project89-profile/1",
    suggested_role: "Signal Weaver",
    suggested_drive: "Connect",
    suggestion_is_mechanical_authority: false,
  });
});
