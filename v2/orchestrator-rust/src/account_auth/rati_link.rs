//! The RATi link: one message every RATi app uses to link an identity to a
//! Solana wallet (atimics/forge `docs/rati-link.md`). CosyWorld names the
//! account as the identity; the wallet signs the message, and the account's
//! recent passkey session stands in for the identity's signature.

/// The app name CosyWorld links use.
pub(super) const RATI_LINK_APP: &str = "cosyworld";

const NOTICE: &str = "This links the identity to the wallet. It does not authorize a transaction.";

/// The RATi link message, or `None` when a field could forge a line: the
/// identity must be 1–128 bytes of printable ASCII without spaces, and the
/// wallet a base58 address. `sequence` is normally the Unix time in seconds.
pub(super) fn rati_link_message(identity: &str, wallet: &str, sequence: u64) -> Option<String> {
    let identity_ok = (1..=128).contains(&identity.len())
        && identity.bytes().all(|byte| (0x21..=0x7e).contains(&byte));
    let wallet_ok = bs58::decode(wallet)
        .into_vec()
        .is_ok_and(|bytes| bytes.len() == 32);
    if !identity_ok || !wallet_ok {
        return None;
    }
    Some(format!(
        "RATi link v1\nApp: {RATI_LINK_APP}\nIdentity: {identity}\nWallet: {wallet}\nSequence: {sequence}\n{NOTICE}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solana::verify_solana_wallet_signature;

    fn hex(text: &str) -> Vec<u8> {
        (0..text.len() / 2)
            .map(|i| u8::from_str_radix(&text[2 * i..2 * i + 2], 16).unwrap())
            .collect()
    }

    const WALLET: &str = "2Q7CEgPw9eDDcmcsZXx8R9ZuGuUapzKAQfzb5CnYeQyn";
    const ACCOUNT: &str = "5f0c2d8e-3a1b-4c7d-9e2f-6a8b0c1d2e3f";

    /// The shared vector, also checked by Forge and Signal.
    #[test]
    fn rati_link_matches_the_shared_vector() {
        let message = rati_link_message(ACCOUNT, WALLET, 1_790_000_000).unwrap();
        assert_eq!(
            message,
            "RATi link v1\nApp: cosyworld\nIdentity: 5f0c2d8e-3a1b-4c7d-9e2f-6a8b0c1d2e3f\nWallet: 2Q7CEgPw9eDDcmcsZXx8R9ZuGuUapzKAQfzb5CnYeQyn\nSequence: 1790000000\nThis links the identity to the wallet. It does not authorize a transaction."
        );
        let signature = hex("b25350cdf35b22447ae7148f2f982e2ce872216432dcbd88540f903e5774f5a3082ec9736e684e977305b235dd40385b7163c25a062515d618b2c9b432531a01");
        assert!(verify_solana_wallet_signature(WALLET, &message, &signature));
        let other = rati_link_message(ACCOUNT, WALLET, 1_790_000_001).unwrap();
        assert!(!verify_solana_wallet_signature(WALLET, &other, &signature));
    }

    #[test]
    fn rati_link_refuses_fields_that_could_forge_a_line() {
        for identity in [
            "",
            "has space",
            "id\nWallet: x",
            "caf\u{e9}",
            &"i".repeat(129),
        ] {
            assert_eq!(rati_link_message(identity, WALLET, 1), None, "{identity:?}");
        }
        assert_eq!(rati_link_message(ACCOUNT, "not-base58!", 1), None);
        assert_eq!(rati_link_message(ACCOUNT, "11111111", 1), None);
    }
}
