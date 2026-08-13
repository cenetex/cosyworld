//! raticross v1 header — Rust encoder that matches the C spec.
//!
//! `native/include/raticross.h` is the definition. This file is a
//! binding. If it disagrees with the frozen vectors, it is wrong.

use ed25519_dalek::Signer;
use ed25519_dalek::Verifier;
use sha2::{Digest, Sha256};

pub const HEADER_SIZE: usize = 192;
pub const PUBKEY_SIZE: usize = 32;
pub const ID_SIZE: usize = 16;
pub const HASH_SIZE: usize = 32;
pub const SIG_SIZE: usize = 64;
pub const MAX_PAYLOAD: usize = 65535;

pub const KIND_SESSION: u8 = 0;
pub const KIND_AVATAR: u8 = 1;
pub const KIND_AGENT: u8 = 2;
pub const KIND_SYSTEM: u8 = 3;
pub const FLAG_HAS_LEASE: u8 = 1;

const OFF_VERSION: usize = 0;
const OFF_FROM_KIND: usize = 1;
const OFF_AS_KIND: usize = 2;
const OFF_TO_KIND: usize = 3;
const OFF_FLAGS: usize = 4;
const OFF_RESERVED0: usize = 5;
const OFF_AS_PUBKEY: usize = 8;
const OFF_TO_PUBKEY: usize = 40;
const OFF_FROM_PUBKEY: usize = 72;
const OFF_ENVELOPE_ID: usize = 104;
const OFF_TS_MS: usize = 120;
const OFF_LEASE_ID: usize = 128;
const OFF_PAYLOAD_SHA256: usize = 144;
const OFF_PAYLOAD_LEN: usize = 176;
const OFF_RESERVED1: usize = 178;
const RESERVED0_SIZE: usize = 3;
const RESERVED1_SIZE: usize = 14;

fn is_zero(p: &[u8]) -> bool { p.iter().all(|b| *b == 0) }
fn is_actor_kind(k: u8) -> bool { k == KIND_AVATAR || k == KIND_AGENT || k == KIND_SYSTEM }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RcError { Version, Kind, Reserved, Flag, Pubkey, Lease, Session, Impersonation, Short, Hash, Verify }

#[derive(Debug, Clone)]
pub struct Header {
    pub from_kind: u8,
    pub as_kind: u8,
    pub to_kind: u8,
    pub flags: u8,
    pub as_pubkey: [u8; PUBKEY_SIZE],
    pub to_pubkey: [u8; PUBKEY_SIZE],
    pub from_pubkey: [u8; PUBKEY_SIZE],
    pub envelope_id: [u8; ID_SIZE],
    pub ts_ms: u64,
    pub lease_id: [u8; ID_SIZE],
    pub payload_sha256: [u8; HASH_SIZE],
    pub payload_len: u16,
}

impl Default for Header {
    fn default() -> Self {
        Self {
            from_kind: 0, as_kind: KIND_AVATAR, to_kind: KIND_SYSTEM, flags: 0,
            as_pubkey: [0u8; PUBKEY_SIZE], to_pubkey: [0u8; PUBKEY_SIZE],
            from_pubkey: [0u8; PUBKEY_SIZE], envelope_id: [0u8; ID_SIZE],
            ts_ms: 0, lease_id: [0u8; ID_SIZE],
            payload_sha256: [0u8; HASH_SIZE], payload_len: 0,
        }
    }
}

pub fn header_actor(
    kind: u8, as_pk: &[u8; PUBKEY_SIZE], to_kind: u8, to_pk: &[u8; PUBKEY_SIZE],
    envelope_id: &[u8; ID_SIZE], ts_ms: u64,
) -> Result<Header, RcError> {
    if !is_actor_kind(kind) || !is_actor_kind(to_kind) { return Err(RcError::Kind); }
    if is_zero(as_pk) || is_zero(to_pk) { return Err(RcError::Pubkey); }
    Ok(Header {
        from_kind: kind, as_kind: kind, to_kind, flags: 0,
        as_pubkey: *as_pk, to_pubkey: *to_pk, from_pubkey: *as_pk,
        envelope_id: *envelope_id, ts_ms, lease_id: [0u8; ID_SIZE],
        payload_sha256: [0u8; HASH_SIZE], payload_len: 0,
    })
}

pub fn header_session(
    as_kind: u8, as_pk: &[u8; PUBKEY_SIZE], to_kind: u8, to_pk: &[u8; PUBKEY_SIZE],
    envelope_id: &[u8; ID_SIZE], lease_id: &[u8; ID_SIZE], ts_ms: u64,
) -> Result<Header, RcError> {
    if !is_actor_kind(as_kind) || !is_actor_kind(to_kind) { return Err(RcError::Kind); }
    if is_zero(as_pk) || is_zero(to_pk) { return Err(RcError::Pubkey); }
    if is_zero(lease_id) { return Err(RcError::Lease); }
    Ok(Header {
        from_kind: KIND_SESSION, as_kind, to_kind, flags: FLAG_HAS_LEASE,
        as_pubkey: *as_pk, to_pubkey: *to_pk, from_pubkey: [0u8; PUBKEY_SIZE],
        envelope_id: *envelope_id, ts_ms, lease_id: *lease_id,
        payload_sha256: [0u8; HASH_SIZE], payload_len: 0,
    })
}

fn write_le16(out: &mut [u8], pos: usize, v: u16) { out[pos] = v as u8; out[pos+1] = (v>>8) as u8; }
fn write_le64(out: &mut [u8], pos: usize, mut v: u64) { for i in 0..8 { out[pos+i] = v as u8; v >>= 8; } }
fn read_le16(inp: &[u8], pos: usize) -> u16 { inp[pos] as u16 | ((inp[pos+1] as u16) << 8) }
fn read_le64(inp: &[u8], pos: usize) -> u64 { (0..8).rev().fold(0u64, |v,i| (v << 8) | (inp[pos+i] as u64)) }

pub fn encode(h: &Header) -> Result<[u8; HEADER_SIZE], RcError> {
    validate(h)?;
    let mut out = [0u8; HEADER_SIZE];
    out[OFF_VERSION] = 1;
    out[OFF_FROM_KIND] = h.from_kind;
    out[OFF_AS_KIND] = h.as_kind;
    out[OFF_TO_KIND] = h.to_kind;
    out[OFF_FLAGS] = h.flags;
    out[OFF_AS_PUBKEY..][..PUBKEY_SIZE].copy_from_slice(&h.as_pubkey);
    out[OFF_TO_PUBKEY..][..PUBKEY_SIZE].copy_from_slice(&h.to_pubkey);
    out[OFF_FROM_PUBKEY..][..PUBKEY_SIZE].copy_from_slice(&h.from_pubkey);
    out[OFF_ENVELOPE_ID..][..ID_SIZE].copy_from_slice(&h.envelope_id);
    write_le64(&mut out, OFF_TS_MS, h.ts_ms);
    out[OFF_LEASE_ID..][..ID_SIZE].copy_from_slice(&h.lease_id);
    out[OFF_PAYLOAD_SHA256..][..HASH_SIZE].copy_from_slice(&h.payload_sha256);
    write_le16(&mut out, OFF_PAYLOAD_LEN, h.payload_len);
    Ok(out)
}

pub fn decode(input: &[u8]) -> Result<Header, RcError> {
    if input.len() < HEADER_SIZE { return Err(RcError::Short); }
    if input[OFF_VERSION] != 1 { return Err(RcError::Version); }
    if !is_zero(&input[OFF_RESERVED0..][..RESERVED0_SIZE]) ||
       !is_zero(&input[OFF_RESERVED1..][..RESERVED1_SIZE]) { return Err(RcError::Reserved); }
    let mut h = Header::default();
    h.from_kind = input[OFF_FROM_KIND]; h.as_kind = input[OFF_AS_KIND]; h.to_kind = input[OFF_TO_KIND];
    h.flags = input[OFF_FLAGS];
    h.as_pubkey.copy_from_slice(&input[OFF_AS_PUBKEY..][..PUBKEY_SIZE]);
    h.to_pubkey.copy_from_slice(&input[OFF_TO_PUBKEY..][..PUBKEY_SIZE]);
    h.from_pubkey.copy_from_slice(&input[OFF_FROM_PUBKEY..][..PUBKEY_SIZE]);
    h.envelope_id.copy_from_slice(&input[OFF_ENVELOPE_ID..][..ID_SIZE]);
    h.ts_ms = read_le64(input, OFF_TS_MS);
    h.lease_id.copy_from_slice(&input[OFF_LEASE_ID..][..ID_SIZE]);
    h.payload_sha256.copy_from_slice(&input[OFF_PAYLOAD_SHA256..][..HASH_SIZE]);
    h.payload_len = read_le16(input, OFF_PAYLOAD_LEN);
    validate(&h)?;
    Ok(h)
}

pub fn validate(h: &Header) -> Result<(), RcError> {
    if !is_actor_kind(h.as_kind) || !is_actor_kind(h.to_kind) { return Err(RcError::Kind); }
    if is_zero(&h.as_pubkey) || is_zero(&h.to_pubkey) { return Err(RcError::Pubkey); }
    if h.flags & !FLAG_HAS_LEASE != 0 { return Err(RcError::Flag); }
    if h.from_kind == KIND_SESSION {
        if h.flags & FLAG_HAS_LEASE == 0 || is_zero(&h.lease_id) { return Err(RcError::Lease); }
        if !is_zero(&h.from_pubkey) { return Err(RcError::Session); }
        return Ok(());
    }
    if !is_actor_kind(h.from_kind) { return Err(RcError::Kind); }
    if h.from_kind != h.as_kind || h.from_pubkey != h.as_pubkey { return Err(RcError::Impersonation); }
    if h.flags & FLAG_HAS_LEASE != 0 || !is_zero(&h.lease_id) { return Err(RcError::Lease); }
    Ok(())
}

pub fn bind_payload(h: &mut Header, payload: &[u8]) -> Result<(), RcError> {
    if payload.len() > MAX_PAYLOAD { return Err(RcError::Short); }
    h.payload_len = payload.len() as u16;
    h.payload_sha256.copy_from_slice(Sha256::digest(payload).as_slice());
    Ok(())
}

pub fn message_size(payload_len: u16) -> usize { HEADER_SIZE + payload_len as usize + SIG_SIZE }

pub fn message_encode(h: &Header, payload: &[u8], sig: &[u8; SIG_SIZE], out: &mut [u8]) -> Result<usize, RcError> {
    let need = message_size(h.payload_len);
    if out.len() < need { return Err(RcError::Short); }
    if h.payload_len > 0 && Sha256::digest(payload).as_slice() != h.payload_sha256 { return Err(RcError::Hash); }
    encode(h)?.iter().enumerate().for_each(|(i, b)| out[i] = *b);
    if h.payload_len > 0 { out[HEADER_SIZE..][..payload.len()].copy_from_slice(payload); }
    out[HEADER_SIZE + h.payload_len as usize..need].copy_from_slice(sig);
    Ok(need)
}

pub fn message_decode(msg: &[u8]) -> Result<(Header, Vec<u8>, [u8; SIG_SIZE]), RcError> {
    if msg.len() < HEADER_SIZE + SIG_SIZE { return Err(RcError::Short); }
    let h = decode(&msg[..HEADER_SIZE])?;
    let need = message_size(h.payload_len);
    if msg.len() < need { return Err(RcError::Short); }
    if msg.len() > need { return Err(RcError::Short); }
    let payload = msg[HEADER_SIZE..][..h.payload_len as usize].to_vec();
    if h.payload_len > 0 && Sha256::digest(&payload).as_slice() != h.payload_sha256 { return Err(RcError::Hash); }
    let mut sig = [0u8; SIG_SIZE]; sig.copy_from_slice(&msg[HEADER_SIZE + h.payload_len as usize..need]);
    Ok((h, payload, sig))
}

pub fn sign_header(h: &Header, sk: &ed25519_dalek::SigningKey) -> Result<[u8; SIG_SIZE], RcError> {
    let sig = sk.sign(&encode(h)?);
    let mut out = [0u8; SIG_SIZE]; out.copy_from_slice(&sig.to_bytes()); Ok(out)
}

pub fn verify_header(hdr: &[u8; HEADER_SIZE], pk: &ed25519_dalek::VerifyingKey, sig: &[u8; SIG_SIZE]) -> Result<(), RcError> {
    pk.verify(hdr, &ed25519_dalek::Signature::from_bytes(sig)).map_err(|_| RcError::Verify)
}

pub fn message_open(msg: &[u8], verify_pk: &ed25519_dalek::VerifyingKey) -> Result<(Header, Vec<u8>), RcError> {
    let (h, payload, sig) = message_decode(msg)?;
    verify_header(msg[..HEADER_SIZE].try_into().unwrap(), verify_pk, &sig)?;
    Ok((h, payload))
}

/// Issue a citizen from a 32-byte seed.
pub fn keypair_from_seed(seed: &[u8; 32]) -> ed25519_dalek::SigningKey {
    let sk: ed25519_dalek::SecretKey = *seed;
    ed25519_dalek::SigningKey::from(sk)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_decode(s: &str) -> Vec<u8> { (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i+2], 16).unwrap()).collect() }

    #[test]
    fn session_header_matches_frozen() {
        let mut as_pk = [0u8; PUBKEY_SIZE]; as_pk[0] = 0x11; as_pk[31] = 0xee;
        let mut to_pk = [0u8; PUBKEY_SIZE]; to_pk[0] = 0x22; to_pk[31] = 0xdd;
        let mut eid = [0u8; ID_SIZE]; eid[0] = 0x01; eid[15] = 0xa1;
        let mut lid = [0u8; ID_SIZE]; lid[0] = 0x02; lid[15] = 0xa2;
        let h = header_session(KIND_AVATAR, &as_pk, KIND_SYSTEM, &to_pk, &eid, &lid, 1).unwrap();
        let wire = encode(&h).unwrap();
        let expected = "010001030100000011000000000000000000000000000000000000000000000000000000000000ee22000000000000000000000000000000000000000000000000000000000000dd0000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000a10100000000000000020000000000000000000000000000a2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        assert_eq!(hex::encode(&wire), expected, "Rust header must match frozen vector");
    }

    #[test]
    fn actor_header_matches_frozen() {
        let mut as_pk = [0u8; PUBKEY_SIZE]; as_pk[0] = 0x11; as_pk[31] = 0xee;
        let mut to_pk = [0u8; PUBKEY_SIZE]; to_pk[0] = 0x22; to_pk[31] = 0xdd;
        let mut eid = [0u8; ID_SIZE]; eid[0] = 0x03; eid[15] = 0xa3;
        let mut h = header_actor(KIND_AVATAR, &as_pk, KIND_SYSTEM, &to_pk, &eid, 0x0102030405060708).unwrap();
        bind_payload(&mut h, b"hi").unwrap();
        let wire = encode(&h).unwrap();
        let expected = "010101030000000011000000000000000000000000000000000000000000000000000000000000ee22000000000000000000000000000000000000000000000000000000000000dd11000000000000000000000000000000000000000000000000000000000000ee030000000000000000000000000000a30807060504030201000000000000000000000000000000008f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa402000000000000000000000000000000";
        assert_eq!(hex::encode(&wire), expected, "actor header must match frozen vector");
    }

    #[test]
    fn session_sealed_verify() {
        let msg = hex_decode("01000103010000004cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba297422b9887598068e32c4448a949adb290d0f4e35b9e01b0ee5f1a1e600fe26740000000000000000000000000000000000000000000000000000000000000000de0000000000000000000000000000ad0807060504030201be0000000000000000000000000000ef78eba9c0328230b043d0ff4cc2c3142e2363a91f3df72d2010b79dfc3e4e09470800000000000000000000000000000068656c6c6f010203ee6aaff30fd2743829e39e67e5bd0b343b393ef1710964e1ea97cc8647aad0baa76cdb22fe141b0ea1efa716f226c30b005b888764e256d5a2ae9c92226d130b");
        let pk_bytes: [u8; 32] = hex_decode("4cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba29").try_into().unwrap();
        let vk = ed25519_dalek::VerifyingKey::from_bytes(&pk_bytes).unwrap();
        let (h, payload, _sig) = message_decode(&msg).unwrap();
        assert_eq!(h.from_kind, KIND_SESSION);
        assert_eq!(payload, b"hello\x01\x02\x03");
        assert!(message_open(&msg, &vk).is_ok());
    }

    #[test]
    fn actor_sealed_verify() {
        let msg = hex_decode("01010103000000004cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba297422b9887598068e32c4448a949adb290d0f4e35b9e01b0ee5f1a1e600fe26744cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba29de0000000000000000000000000000ad08070605040302010000000000000000000000000000000078eba9c0328230b043d0ff4cc2c3142e2363a91f3df72d2010b79dfc3e4e09470800000000000000000000000000000068656c6c6f010203208fc9f312e59cc5f30f8720f75510c8e1b624d921629bbe609aee74dfe8de2b3119c9952ed34305785e82a5ade589be55bc61803365871c20d422faebfd9402");
        let pk_bytes: [u8; 32] = hex_decode("4cb5abf6ad79fbf5abbccafcc269d85cd2651ed4b885b5869f241aedf0a5ba29").try_into().unwrap();
        let vk = ed25519_dalek::VerifyingKey::from_bytes(&pk_bytes).unwrap();
        let (h, _payload, _sig) = message_decode(&msg).unwrap();
        assert_eq!(h.from_kind, KIND_AVATAR);
        assert!(message_open(&msg, &vk).is_ok());
    }

    #[test]
    fn reject_session_with_pubkey() {
        // session with zero lease_id should fail
        let _ = header_session(KIND_AVATAR, &[0xab; PUBKEY_SIZE], KIND_SYSTEM, &[0xcd; PUBKEY_SIZE],
                                &[0; ID_SIZE], &[0; ID_SIZE], 0).unwrap_err();
        // valid session: from_pubkey is forced zero by construction
        let mut as_pk = [0x11u8; PUBKEY_SIZE]; as_pk[31] = 0xee;
        let mut to_pk = [0x22u8; PUBKEY_SIZE]; to_pk[31] = 0xdd;
        let mut eid = [0u8; ID_SIZE]; eid[0] = 0x1;
        let mut lid = [0u8; ID_SIZE]; lid[0] = 0x1;
        let h = header_session(KIND_AVATAR, &as_pk, KIND_SYSTEM, &to_pk, &eid, &lid, 1).unwrap();
        assert_eq!(h.from_pubkey, [0u8; PUBKEY_SIZE]);
    }
}