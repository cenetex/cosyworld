use ed25519_dalek::{Signature, Verifier, VerifyingKey};

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
