#![deny(unsafe_code)]

/// Public card-game files, embedded at build time. build.rs generates this
/// module from v2/card-game/public-assets.mjs, so it is never committed.
pub mod card_assets {
    include!(concat!(env!("OUT_DIR"), "/card_assets.rs"));
}
pub mod card_policy;
