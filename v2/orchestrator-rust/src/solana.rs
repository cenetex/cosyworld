use super::*;

use super::config::deployment_config_error;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rand::{rngs::OsRng, RngCore};

pub(crate) const CORE_PROGRAM_ID: &str = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
pub(crate) const SOLANA_SYSTEM_PROGRAM_ID: &str = "11111111111111111111111111111111";
pub(crate) const SPL_NOOP_PROGRAM_ID: &str = "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV";

#[derive(Clone, Debug)]
pub(crate) struct BoxBurnVerifierConfig {
    pub(super) rpc_url: String,
    pub(super) collection_address: String,
}

#[derive(Clone, Debug)]
pub(crate) struct BoxBurnVerification {
    pub(super) verification_status: &'static str,
}

#[derive(Clone, Debug)]
pub(crate) struct PreparedBoxBurnTransaction {
    pub(super) transaction_base64: String,
    pub(super) message_base58: String,
    pub(super) recent_blockhash: String,
    pub(super) last_valid_block_height: u64,
}

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

pub(crate) fn normalize_asset_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > 160
        || trimmed
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn normalize_burn_signature(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > 160
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn clean_solana_address(value: &str, label: &str) -> Result<String, String> {
    let clean = value.trim();
    if clean.len() < 32 || clean.len() > 44 || !clean.chars().all(is_base58_char) {
        Err(format!("{label} is invalid"))
    } else {
        Ok(clean.to_string())
    }
}

pub(crate) fn clean_solana_signature(value: &str, label: &str) -> Result<String, String> {
    let clean = value.trim();
    if clean.len() < 64 || clean.len() > 96 || !clean.chars().all(is_base58_char) {
        Err(format!("{label} is invalid"))
    } else {
        Ok(clean.to_string())
    }
}

pub(crate) fn is_base58_char(ch: char) -> bool {
    matches!(
        ch,
        '1'..='9'
            | 'A'..='H'
            | 'J'..='N'
            | 'P'..='Z'
            | 'a'..='k'
            | 'm'..='z'
    )
}

pub(crate) fn decode_solana_32(value: &str, label: &str) -> Result<[u8; 32], String> {
    let clean = clean_solana_address(value, label)?;
    let bytes = bs58::decode(&clean)
        .into_vec()
        .map_err(|_| format!("{label} is invalid"))?;
    bytes
        .try_into()
        .map_err(|_| format!("{label} must decode to 32 bytes"))
}

pub(crate) fn push_solana_shortvec(output: &mut Vec<u8>, mut value: usize) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        output.push(byte);
        if value == 0 {
            break;
        }
    }
}

pub(crate) fn compile_core_burn_transaction(
    owner_wallet_address: &str,
    box_asset_address: &str,
    collection_address: &str,
    recent_blockhash: &str,
    last_valid_block_height: u64,
) -> Result<PreparedBoxBurnTransaction, String> {
    let owner = decode_solana_32(owner_wallet_address, "Owner wallet address")?;
    let asset = decode_solana_32(box_asset_address, "Box asset address")?;
    let collection = decode_solana_32(collection_address, "Box collection address")?;
    let system_program = decode_solana_32(SOLANA_SYSTEM_PROGRAM_ID, "System program")?;
    let log_wrapper = decode_solana_32(SPL_NOOP_PROGRAM_ID, "SPL Noop program")?;
    let core_program = decode_solana_32(CORE_PROGRAM_ID, "Metaplex Core program")?;
    let blockhash = decode_solana_32(recent_blockhash, "Recent blockhash")?;

    if owner == asset || owner == collection || asset == collection {
        return Err("Box burn owner, asset, and collection addresses must be distinct".to_string());
    }

    // Legacy Solana message. The owner is both fee payer and BurnV1 authority, so it appears once
    // as the writable signer. BurnV1 account order follows the generated Metaplex Core SDK:
    // asset, collection, payer, authority, system program, SPL Noop log wrapper.
    let account_keys = [
        owner,
        asset,
        collection,
        system_program,
        log_wrapper,
        core_program,
    ];
    let mut message = Vec::with_capacity(256);
    message.extend_from_slice(&[
        1, // num_required_signatures
        0, // num_readonly_signed_accounts
        3, // system, log wrapper, and Core are readonly unsigned accounts
    ]);
    push_solana_shortvec(&mut message, account_keys.len());
    for key in account_keys {
        message.extend_from_slice(&key);
    }
    message.extend_from_slice(&blockhash);
    push_solana_shortvec(&mut message, 1); // one BurnV1 instruction
    message.push(5); // Core program account index
    let burn_accounts = [1_u8, 2, 0, 0, 3, 4];
    push_solana_shortvec(&mut message, burn_accounts.len());
    message.extend_from_slice(&burn_accounts);
    let burn_data = [12_u8, 0_u8]; // BurnV1 discriminator + None compression proof
    push_solana_shortvec(&mut message, burn_data.len());
    message.extend_from_slice(&burn_data);

    // A legacy wire transaction is a shortvec signature count, one empty 64-byte signature for
    // the owner, then the compiled message. Wallets replace the empty signature before sending.
    let mut transaction = Vec::with_capacity(message.len() + 65);
    push_solana_shortvec(&mut transaction, 1);
    transaction.extend_from_slice(&[0_u8; 64]);
    transaction.extend_from_slice(&message);

    Ok(PreparedBoxBurnTransaction {
        transaction_base64: BASE64_STANDARD.encode(transaction),
        message_base58: bs58::encode(message).into_string(),
        recent_blockhash: recent_blockhash.to_string(),
        last_valid_block_height,
    })
}

pub(crate) fn transaction_burns_core_asset_from_owner(
    transaction: &serde_json::Value,
    asset_address: &str,
    owner_wallet_address: &str,
    collection_address: &str,
) -> bool {
    let mut instructions = Vec::new();
    collect_parsed_instructions(
        transaction
            .pointer("/transaction/message/instructions")
            .unwrap_or(&serde_json::Value::Null),
        &mut instructions,
    );
    collect_parsed_instructions(
        transaction
            .pointer("/meta/innerInstructions")
            .unwrap_or(&serde_json::Value::Null),
        &mut instructions,
    );

    instructions.into_iter().any(|instruction| {
        let program_id = instruction
            .get("programId")
            .and_then(|value| value.as_str());
        if program_id != Some(CORE_PROGRAM_ID) {
            return false;
        }
        let Some(accounts) = instruction
            .get("accounts")
            .and_then(|value| value.as_array())
        else {
            return false;
        };
        let account_strings = accounts
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>();
        if account_strings.first().copied() != Some(asset_address)
            || account_strings.get(1).copied() != Some(collection_address)
            || !account_strings.contains(&owner_wallet_address)
        {
            return false;
        }
        let Some(data) = instruction.get("data").and_then(|value| value.as_str()) else {
            return false;
        };
        bs58::decode(data)
            .into_vec()
            .ok()
            .and_then(|bytes| bytes.first().copied())
            == Some(12)
    })
}

pub(crate) fn collect_parsed_instructions<'a>(
    value: &'a serde_json::Value,
    out: &mut Vec<&'a serde_json::Value>,
) {
    let Some(entries) = value.as_array() else {
        return;
    };
    for entry in entries {
        if let Some(nested) = entry.get("instructions") {
            collect_parsed_instructions(nested, out);
        } else {
            out.push(entry);
        }
    }
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
        "CosyWorld wallet access\nWallet: {wallet_address}\nNonce: {nonce}\nIssued: {issued_at_unix}\nPurpose: resolve pack-provided entitlements"
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

impl BoxBurnVerifierConfig {
    pub(crate) fn from_env() -> io::Result<Option<Self>> {
        let rpc_url = std::env::var("COSYWORLD_BOX_BURN_SOLANA_RPC_URL")
            .ok()
            .or_else(|| std::env::var("COSYWORLD_SOLANA_RPC_URL").ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let collection_address = std::env::var("COSYWORLD_BOX_CORE_COLLECTION_ADDRESS")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        match (rpc_url, collection_address) {
            (None, None) => Ok(None),
            (Some(rpc_url), Some(collection_address)) => {
                if !rpc_url.starts_with("http://") && !rpc_url.starts_with("https://") {
                    return Err(deployment_config_error(
                        "COSYWORLD_BOX_BURN_SOLANA_RPC_URL must be an HTTP(S) URL",
                    ));
                }
                let collection_address = clean_solana_address(
                    &collection_address,
                    "COSYWORLD_BOX_CORE_COLLECTION_ADDRESS",
                )
                .map_err(deployment_config_error)?;
                Ok(Some(Self {
                    rpc_url,
                    collection_address,
                }))
            }
            (Some(_), None) => Err(deployment_config_error(
                "COSYWORLD_BOX_BURN_SOLANA_RPC_URL requires COSYWORLD_BOX_CORE_COLLECTION_ADDRESS",
            )),
            (None, Some(_)) => Err(deployment_config_error(
                "COSYWORLD_BOX_CORE_COLLECTION_ADDRESS requires COSYWORLD_BOX_BURN_SOLANA_RPC_URL",
            )),
        }
    }

    pub(crate) async fn prepare_box_burn(
        &self,
        owner_wallet_address: &str,
        box_asset_address: &str,
    ) -> Result<PreparedBoxBurnTransaction, String> {
        let owner_wallet_address =
            clean_solana_address(owner_wallet_address, "Owner wallet address")?;
        let box_asset_address = clean_solana_address(box_asset_address, "Box asset address")?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| error.to_string())?;
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": "cosyworld-box-burn-prepare",
            "method": "getLatestBlockhash",
            "params": [{ "commitment": "confirmed" }]
        });
        let response = client
            .post(&self.rpc_url)
            .json(&body)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "Solana RPC failed with status {}",
                response.status().as_u16()
            ));
        }
        let payload: serde_json::Value =
            response.json().await.map_err(|error| error.to_string())?;
        if let Some(error) = payload.get("error") {
            return Err(error
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("Solana RPC returned an error")
                .to_string());
        }
        let blockhash = payload
            .pointer("/result/value/blockhash")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Solana RPC did not return a recent blockhash".to_string())?;
        let last_valid_block_height = payload
            .pointer("/result/value/lastValidBlockHeight")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| "Solana RPC did not return a last valid block height".to_string())?;
        compile_core_burn_transaction(
            &owner_wallet_address,
            &box_asset_address,
            &self.collection_address,
            blockhash,
            last_valid_block_height,
        )
    }

    pub(crate) async fn verify_box_burn(
        &self,
        owner_wallet_address: &str,
        box_asset_address: &str,
        burn_signature: &str,
    ) -> Result<BoxBurnVerification, String> {
        let owner_wallet_address =
            clean_solana_address(owner_wallet_address, "Owner wallet address")?;
        let box_asset_address = clean_solana_address(box_asset_address, "Box asset address")?;
        let burn_signature = clean_solana_signature(burn_signature, "Solana burn signature")?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| error.to_string())?;
        let mut transaction = serde_json::Value::Null;
        for attempt in 0..4 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(1000 + attempt * 500)).await;
            }
            let body = serde_json::json!({
                "jsonrpc": "2.0",
                "id": "cosyworld-box-burn",
                "method": "getTransaction",
                "params": [
                    burn_signature,
                    {
                        "encoding": "jsonParsed",
                        "maxSupportedTransactionVersion": 0,
                        "commitment": "confirmed"
                    }
                ]
            });
            let response = client
                .post(&self.rpc_url)
                .json(&body)
                .send()
                .await
                .map_err(|error| error.to_string())?;
            if !response.status().is_success() {
                return Err(format!(
                    "Solana RPC failed with status {}",
                    response.status().as_u16()
                ));
            }
            let payload: serde_json::Value =
                response.json().await.map_err(|error| error.to_string())?;
            if let Some(error) = payload.get("error") {
                return Err(error
                    .get("message")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Solana RPC returned an error")
                    .to_string());
            }
            transaction = payload
                .get("result")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            if !transaction.is_null() {
                break;
            }
        }

        if transaction.is_null() {
            return Err("Solana burn transaction was not found yet".to_string());
        }
        if !transaction
            .pointer("/meta/err")
            .is_none_or(|value| value.is_null())
        {
            return Err("Solana burn transaction failed on-chain".to_string());
        }
        let signatures = transaction
            .pointer("/transaction/signatures")
            .and_then(|value| value.as_array())
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if !signatures.contains(&burn_signature.as_str()) {
            return Err("Solana RPC returned a different burn transaction".to_string());
        }
        if !transaction_burns_core_asset_from_owner(
            &transaction,
            &box_asset_address,
            &owner_wallet_address,
            &self.collection_address,
        ) {
            return Err("Solana transaction does not burn this CosyWorld Box".to_string());
        }

        Ok(BoxBurnVerification {
            verification_status: "solana_core_burn_verified",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_burn_transaction_compiles_expected_metaplex_message() {
        let owner = "DcfmEZ6tw7BGJo1a7TozkCoGJZNFJxCBJS5axj7oy4ES";
        let asset = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
        let collection = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
        let blockhash = "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH";
        let prepared = compile_core_burn_transaction(owner, asset, collection, blockhash, 777)
            .expect("compile Core BurnV1 transaction");

        assert_eq!(prepared.recent_blockhash, blockhash);
        assert_eq!(prepared.last_valid_block_height, 777);
        let transaction = BASE64_STANDARD
            .decode(&prepared.transaction_base64)
            .expect("decode transaction wire bytes");
        let message = bs58::decode(&prepared.message_base58)
            .into_vec()
            .expect("decode compiled message");
        assert_eq!(transaction[0], 1, "one required signature slot");
        assert!(transaction[1..65].iter().all(|byte| *byte == 0));
        assert_eq!(&transaction[65..], message.as_slice());

        assert_eq!(&message[..4], &[1, 0, 3, 6]);
        let expected_keys = [
            owner,
            asset,
            collection,
            SOLANA_SYSTEM_PROGRAM_ID,
            SPL_NOOP_PROGRAM_ID,
            CORE_PROGRAM_ID,
        ];
        for (index, address) in expected_keys.into_iter().enumerate() {
            let start = 4 + index * 32;
            assert_eq!(
                &message[start..start + 32],
                decode_solana_32(address, "expected address")
                    .expect("decode expected address")
                    .as_slice()
            );
        }
        assert_eq!(
            &message[196..228],
            decode_solana_32(blockhash, "expected blockhash")
                .expect("decode expected blockhash")
                .as_slice()
        );
        assert_eq!(
            &message[228..],
            &[1, 5, 6, 1, 2, 0, 0, 3, 4, 2, 12, 0],
            "one Core BurnV1 instruction with a None compression proof"
        );
    }
}
