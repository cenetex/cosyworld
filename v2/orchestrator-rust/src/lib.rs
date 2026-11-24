#![deny(unsafe_code)]

/// Public card-game files, embedded by build.rs from public-assets.mjs.
pub mod card_assets {
    include!(concat!(env!("OUT_DIR"), "/card_assets.rs"));
}
pub mod card_files;
pub mod card_policy;
