#![deny(unsafe_code)]

#[path = "card_files.rs"]
pub mod card_assets;
pub mod card_policy;

#[cfg(feature = "rules-wasm")]
pub use cosyworld_rules_host as rules_wasm;
