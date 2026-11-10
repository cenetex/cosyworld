//! Accompany v1 (ADR 0009 amendment): a player travels one leg together with
//! one bonded resident.
//!
//! The Story Hand combination Avatar + Location resolves to "Travel with
//! <resident> to <place>". The offer belongs to the destination Location card
//! and names the companion in its stable id (`accompany:<destination>:<companion>`),
//! so the resident's Avatar card must be selected too, exactly as Trade names
//! its second actor. One kernel action moves both actors or neither.
//!
//! Consent is a certified rule over authored state, never generated dialogue:
//! the companion must be a free AI resident the player holds a forming or
//! active Bond with. The same rule builds the offer and gates the journal
//! record, so replay applies exactly what was accepted.

use super::*;

pub(crate) const ACCOMPANY_OFFER_KIND: &str = "accompany";

impl RuntimeWorld {}
