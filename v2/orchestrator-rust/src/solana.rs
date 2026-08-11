use super::*;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rand::{rngs::OsRng, RngCore};

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum WalletSignatureInput {
    Bytes(Vec<u8>),
    Base58(String),
}
impl WalletSignatureInput {
    pub(crate) fn bytes(&self) -> Option<Vec<u8>> {
        match self {
            Self::Bytes(bytes) => Some(bytes.clone()),
            Self::Base58(value) => bs58::decode(value.trim()).into_vec().ok(),
        }
    }
}

pub(crate) fn verify_solana_wallet_signature(
    wallet_address: &str,
    message: &str,
    signature: &[u8],
) -> bool {
    let Ok(public_key_bytes) = bs58::decode(wallet_address).into_vec() else {
        return false;
    };
    let Ok(public_key_bytes) = <[u8; 32]>::try_from(public_key_bytes.as_slice()) else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_key_bytes) else {
        return false;
    };
    let Ok(signature) = Signature::from_slice(signature) else {
        return false;
    };
    verifying_key.verify(message.as_bytes(), &signature).is_ok()
}

pub(crate) fn stable_hash_u64(parts: &[&str]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for part in parts {
        for byte in part.as_bytes().iter().copied().chain([0xff]) {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    hash
}

pub(crate) fn stable_hash_hex(parts: &[&str]) -> String {
    format!("{:016x}", stable_hash_u64(parts))
}

pub(crate) fn random_hex(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    let mut out = String::with_capacity(byte_count * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub(crate) fn wallet_challenge_message(
    wallet_address: &str,
    nonce: &str,
    issued_at_unix: u64,
) -> String {
    format!(
        "CosyWorld linked-avatar access\nWallet: {wallet_address}\nNonce: {nonce}\nIssued: {issued_at_unix}\nPurpose: discover and recover supported linked avatars"
    )
}

pub(crate) fn narrative_move_signature_message(
    wallet_address: &str,
    session_id: &str,
    character_id: u64,
    command: &str,
    nonce: &str,
    issued_at_unix: u64,
) -> String {
    format!(
        "CosyWorld narrative move\nWallet: {wallet_address}\nSession: {session_id}\nCharacter: {character_id}\nCommand: {command}\nNonce: {nonce}\nIssued: {issued_at_unix}"
    )
}

pub(crate) fn narrative_move_delegation_message(
    wallet_address: &str,
    delegate_address: &str,
    session_id: &str,
    character_id: u64,
    issued_at_unix: u64,
    expires_at_unix: u64,
) -> String {
    format!(
        "CosyWorld narrative move delegation\nWallet: {wallet_address}\nDelegate: {delegate_address}\nSession: {session_id}\nCharacter: {character_id}\nIssued: {issued_at_unix}\nExpires: {expires_at_unix}"
    )
}

pub(crate) fn delegated_narrative_move_signature_message(
    wallet_address: &str,
    delegate_address: &str,
    session_id: &str,
    character_id: u64,
    command: &str,
    nonce: &str,
    issued_at_unix: u64,
) -> String {
    format!(
        "CosyWorld delegated narrative move\nWallet: {wallet_address}\nDelegate: {delegate_address}\nSession: {session_id}\nCharacter: {character_id}\nCommand: {command}\nNonce: {nonce}\nIssued: {issued_at_unix}"
    )
}
