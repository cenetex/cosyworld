//! Resident drive grammar and decay mechanics.
//!
//! Drives are *inclinations toward relationship patterns* between three
//! primitives — avatars (`A`), locations (`L`), and items (`I`). A drive
//! expresses *what kind of relationship* a resident is drawn toward; the
//! concrete goal (which specific avatar, which location, which item) is
//! generated from the drive plus the resident's beliefs about the current
//! world state.
//!
//! This separates three layers that the autonomy system previously conflated:
//!
//! - **Drives** — *why*: typed inclinations toward relationship patterns,
//!   with strengths that decay when satisfied and recover toward a baseline.
//! - **Goals** — *what*: concrete desired relationship states ("the grail in
//!   Jerusalem with Tapi"), derived from drives + beliefs. *(Not yet
//!   implemented; this module establishes the vocabulary.)*
//! - **Actions** — *how*: the steps to achieve a goal, planned by the
//!   existing planner and validated by the C kernel.
//!
//! The grammar is compositional. The existing autonomy verbs are already
//! implicit combinations: trade = `AI`, delivery = `ALI`, seek = `IL`,
//! roam = `L`. Naming them makes the system extensible — a pack authors
//! drives instead of hardcoding verbs.
//!
//! ## Decay model
//!
//! Each drive has a `strength` (current urgency, 0.0–1.0) and a `baseline`
//! (resting level, the resident's personality). When a goal matching a
//! drive's pattern is achieved, the strength drops (`satisfy`), creating
//! satiety. Over time, strength recovers toward baseline (`recover`),
//! creating renewed hunger. The rate is configurable per drive.

// This module establishes the drive grammar vocabulary and decay mechanics.
// The types are not yet wired into the running autonomy system; that
// integration is a follow-up PR. Suppress dead-code warnings for the
// foundation API until it is consumed.
#![allow(dead_code)]

use super::super::*;

use std::cmp::Ordering;
use std::fmt;
use std::str::FromStr;

/// A single atom in the drive grammar: the kind of world-entity a drive
/// relates to.
///
/// The string form is a single lowercase letter (`a`, `l`, `i`) so that a
/// multi-atom pattern serializes as a compact word like `"ali"` or `"alli"`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DriveAtom {
    /// Another actor / avatar.
    Avatar,
    /// A place in the world.
    Location,
    /// A tangible object.
    Item,
}

impl DriveAtom {
    fn as_char(self) -> char {
        match self {
            Self::Avatar => 'a',
            Self::Location => 'l',
            Self::Item => 'i',
        }
    }

    fn from_char(c: char) -> Option<Self> {
        match c {
            'a' | 'A' => Some(Self::Avatar),
            'l' | 'L' => Some(Self::Location),
            'i' | 'I' => Some(Self::Item),
            _ => None,
        }
    }
}

impl fmt::Display for DriveAtom {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.as_char())
    }
}

/// A drive pattern: an ordered sequence of [`DriveAtom`]s describing the
/// *kind of relationship* a resident is inclined toward.
///
/// The order encodes direction. `AI` means "an avatar-item relationship"
/// (the resident wants some avatar to have some item — giving, trading);
/// `IA` means "an item-avatar relationship" (the resident wants an item from
/// some avatar — taking, seeking). Patterns with repeated atoms describe
/// richer configurations: `ALLI` is "an avatar who wants an item moved from
/// one location to another" (delivery quests).
///
/// Patterns serialize as their atoms concatenated: `AI` → `"ai"`, `ALI` →
/// `"ali"`. This is the pack-authorable string form.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub(crate) struct DrivePattern {
    /// Atoms in canonical order. Non-empty.
    atoms: Vec<DriveAtom>,
}

impl DrivePattern {
    /// Creates a pattern from atoms. Panics in debug if empty.
    pub(crate) fn new(atoms: Vec<DriveAtom>) -> Self {
        debug_assert!(!atoms.is_empty(), "DrivePattern must be non-empty");
        Self { atoms }
    }

    /// Single-atom patterns.
    pub(crate) fn avatar() -> Self {
        Self::new(vec![DriveAtom::Avatar])
    }
    pub(crate) fn location() -> Self {
        Self::new(vec![DriveAtom::Location])
    }
    pub(crate) fn item() -> Self {
        Self::new(vec![DriveAtom::Item])
    }

    /// Two-atom patterns.
    pub(crate) fn avatar_item() -> Self {
        Self::new(vec![DriveAtom::Avatar, DriveAtom::Item])
    }
    pub(crate) fn avatar_location() -> Self {
        Self::new(vec![DriveAtom::Avatar, DriveAtom::Location])
    }
    pub(crate) fn item_location() -> Self {
        Self::new(vec![DriveAtom::Item, DriveAtom::Location])
    }

    /// Three-atom pattern: the full triad.
    pub(crate) fn avatar_location_item() -> Self {
        Self::new(vec![
            DriveAtom::Avatar,
            DriveAtom::Location,
            DriveAtom::Item,
        ])
    }

    /// Four-atom pattern: item transport between locations for an avatar.
    pub(crate) fn avatar_location_location_item() -> Self {
        Self::new(vec![
            DriveAtom::Avatar,
            DriveAtom::Location,
            DriveAtom::Location,
            DriveAtom::Item,
        ])
    }

    /// Returns the atoms, in order.
    pub(crate) fn atoms(&self) -> &[DriveAtom] {
        &self.atoms
    }

    /// The number of atoms in the pattern.
    pub(crate) fn arity(&self) -> usize {
        self.atoms.len()
    }

    /// Whether the pattern contains a given atom.
    pub(crate) fn contains(&self, atom: DriveAtom) -> bool {
        self.atoms.contains(&atom)
    }

    /// Whether this pattern is a superset of (covers) another — i.e., every
    /// atom in `other` appears in `self` at least as many times. A drive with
    /// pattern `ALI` is satisfied by achieving a goal with pattern `AI`
    /// (because the avatar-item relationship is part of the triad).
    pub(crate) fn covers(&self, other: &Self) -> bool {
        let mut remaining = self.atoms.clone();
        for atom in &other.atoms {
            if let Some(pos) = remaining.iter().position(|a| a == atom) {
                remaining.swap_remove(pos);
            } else {
                return false;
            }
        }
        true
    }
}

impl fmt::Display for DrivePattern {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        for atom in &self.atoms {
            write!(f, "{}", atom)?;
        }
        Ok(())
    }
}

impl FromStr for DrivePattern {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let atoms: Vec<DriveAtom> = s
            .trim()
            .chars()
            .map(DriveAtom::from_char)
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| format!("invalid drive pattern '{s}': use only a, l, i"))?;
        if atoms.is_empty() {
            return Err("drive pattern must be non-empty".to_string());
        }
        Ok(Self::new(atoms))
    }
}

/// A single resident drive: an inclination toward a relationship pattern,
/// with a decaying strength and optional bindings to specific entities.
///
/// An **unbound** drive expresses a general inclination ("I tend toward AI
/// relationships") — the goal generator picks specific entities from beliefs.
/// A **bound** drive targets specific entities ("I want item 42 at location
/// 7") and behaves like a concrete desire.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResidentDrive {
    /// The relationship pattern this drive inclines toward.
    pub(crate) pattern: DrivePattern,
    /// Current urgency in `[0.0, 1.0]`. Decays toward `baseline`.
    #[serde(default = "default_strength")]
    pub(crate) strength: f32,
    /// Resting urgency — the personality level the strength recovers toward.
    #[serde(default = "default_strength")]
    pub(crate) baseline: f32,
    /// How fast strength recovers toward baseline, per tick fraction.
    /// Higher = hungrier. In `[0.0, 1.0]`.
    #[serde(default = "default_recover_rate")]
    pub(crate) recover_rate: f32,

    // Optional specific-entity bindings. `None` means "any".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) avatar_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) location_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) item_id: Option<u64>,
}

fn default_strength() -> f32 {
    0.5
}

fn default_recover_rate() -> f32 {
    0.01
}

impl ResidentDrive {
    /// Creates an unbound drive with the given pattern and baseline strength.
    pub(crate) fn new(pattern: DrivePattern, baseline: f32) -> Self {
        Self {
            pattern,
            strength: baseline,
            baseline,
            recover_rate: default_recover_rate(),
            avatar_id: None,
            location_id: None,
            item_id: None,
        }
    }

    /// Binds the drive to a specific avatar.
    pub(crate) fn for_avatar(mut self, avatar_id: u64) -> Self {
        self.avatar_id = Some(avatar_id);
        self
    }

    /// Binds the drive to a specific location.
    pub(crate) fn at_location(mut self, location_id: u64) -> Self {
        self.location_id = Some(location_id);
        self
    }

    /// Binds the drive to a specific item.
    pub(crate) fn for_item(mut self, item_id: u64) -> Self {
        self.item_id = Some(item_id);
        self
    }

    /// Whether the drive names any specific entity. Binding even one atom
    /// makes it a concrete desire rather than a general inclination, so the
    /// goal generator only has to fill in the atoms still left open.
    pub(crate) fn is_bound(&self) -> bool {
        self.avatar_id.is_some() || self.location_id.is_some() || self.item_id.is_some()
    }

    /// Recovers strength toward baseline by one tick fraction.
    ///
    /// Uses exponential approach: `strength += (baseline - strength) * rate`.
    /// This means recovery is fast when far from baseline and slows as it
    /// approaches — the Sims-like "hunger returns" curve.
    pub(crate) fn recover(&mut self) {
        let delta = self.baseline - self.strength;
        self.strength += delta * self.recover_rate;
        // Clamp to [0, 1] against floating-point drift.
        self.strength = self.strength.clamp(0.0, 1.0);
    }

    /// Satisfies the drive: drops strength by `factor` (e.g. `0.3` drops to
    /// 30% of current). Creates satiety — the drive becomes less urgent
    /// until it recovers.
    pub(crate) fn satisfy(&mut self, factor: f32) {
        self.strength *= factor;
        self.strength = self.strength.clamp(0.0, 1.0);
    }

    /// Whether the drive is currently urgent enough to act on.
    pub(crate) fn is_urgent(&self, threshold: f32) -> bool {
        self.strength >= threshold
    }
}

/// The collection of drives for one actor, with decay mechanics.
///
/// This is stored on [`ActorAutonomyState`] and persists across journal
/// replay. When empty, it serializes to nothing (via `skip_serializing_if`),
/// so adding the field is transparent to existing journal records.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ActorDriveState {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) drives: Vec<ResidentDrive>,
}

impl ActorDriveState {
    /// Creates an empty drive state.
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Adds a drive.
    pub(crate) fn push(&mut self, drive: ResidentDrive) {
        self.drives.push(drive);
    }

    /// Whether there are no drives.
    pub(crate) fn is_empty(&self) -> bool {
        self.drives.is_empty()
    }

    /// The number of drives.
    pub(crate) fn len(&self) -> usize {
        self.drives.len()
    }

    /// Recovers all drives by one tick fraction. Call this alongside
    /// `replenish_ambient_autonomy_credits`.
    pub(crate) fn recover_all(&mut self) {
        for drive in &mut self.drives {
            drive.recover();
        }
    }

    /// Satisfies all drives whose pattern exactly matches `achieved`.
    ///
    /// When a resident achieves a goal (e.g. a delivery = `ALI`), the drive
    /// with pattern `ALI` is satisfied. Sub-pattern drives are not auto-
    /// satisfied: completing a delivery does not satiate the `L`-only roaming
    /// drive, because being-at-a-location-as-part-of-a-delivery is a different
    /// relationship than the general inclination to roam. Each drive is an
    /// independent inclination with its own satiety.
    pub(crate) fn satisfy(&mut self, achieved: &DrivePattern, factor: f32) {
        for drive in &mut self.drives {
            if drive.pattern == *achieved {
                drive.satisfy(factor);
            }
        }
    }

    /// Returns the drive with the highest current strength, or `None`.
    pub(crate) fn strongest(&self) -> Option<&ResidentDrive> {
        self.drives.iter().max_by(|a, b| {
            a.strength
                .partial_cmp(&b.strength)
                .unwrap_or(Ordering::Equal)
        })
    }

    /// Returns all drives matching a pattern exactly.
    pub(crate) fn for_pattern<'a>(
        &'a self,
        pattern: &DrivePattern,
    ) -> impl Iterator<Item = &'a ResidentDrive> + 'a {
        let pattern = pattern.clone();
        self.drives.iter().filter(move |d| d.pattern == pattern)
    }

    /// Returns all drives that are currently urgent (strength >= threshold).
    pub(crate) fn urgent<'a>(
        &'a self,
        threshold: f32,
    ) -> impl Iterator<Item = &'a ResidentDrive> + 'a {
        self.drives.iter().filter(move |d| d.is_urgent(threshold))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Grammar: parsing and display ──────────────────────────────────

    #[test]
    fn single_atom_patterns_round_trip() {
        for (pattern, expected) in [
            (DrivePattern::avatar(), "a"),
            (DrivePattern::location(), "l"),
            (DrivePattern::item(), "i"),
        ] {
            assert_eq!(pattern.to_string(), expected);
            assert_eq!(pattern, DrivePattern::from_str(expected).unwrap());
        }
    }

    #[test]
    fn multi_atom_patterns_round_trip() {
        for (pattern, expected) in [
            (DrivePattern::avatar_item(), "ai"),
            (DrivePattern::avatar_location(), "al"),
            (DrivePattern::item_location(), "il"),
            (DrivePattern::avatar_location_item(), "ali"),
            (DrivePattern::avatar_location_location_item(), "alli"),
        ] {
            assert_eq!(pattern.to_string(), expected);
            assert_eq!(pattern, DrivePattern::from_str(expected).unwrap());
        }
    }

    #[test]
    fn uppercase_input_is_accepted() {
        assert_eq!(
            DrivePattern::from_str("ALI").unwrap(),
            DrivePattern::avatar_location_item()
        );
    }

    #[test]
    fn invalid_chars_are_rejected() {
        assert!(DrivePattern::from_str("axi").is_err());
        assert!(DrivePattern::from_str("").is_err());
        assert!(DrivePattern::from_str(" ").is_err());
    }

    #[test]
    fn arity_counts_atoms() {
        assert_eq!(DrivePattern::avatar().arity(), 1);
        assert_eq!(DrivePattern::avatar_item().arity(), 2);
        assert_eq!(DrivePattern::avatar_location_item().arity(), 3);
        assert_eq!(DrivePattern::avatar_location_location_item().arity(), 4);
    }

    #[test]
    fn contains_checks_membership() {
        let ali = DrivePattern::avatar_location_item();
        assert!(ali.contains(DriveAtom::Avatar));
        assert!(ali.contains(DriveAtom::Location));
        assert!(ali.contains(DriveAtom::Item));
    }

    // ── Grammar: covers (subset relationship) ───────────────────────────

    #[test]
    fn covers_is_subset_inclusion() {
        let ali = DrivePattern::avatar_location_item();
        assert!(ali.covers(&DrivePattern::avatar_item()));
        assert!(ali.covers(&DrivePattern::avatar_location()));
        assert!(ali.covers(&DrivePattern::item_location()));
        assert!(ali.covers(&DrivePattern::avatar()));
        assert!(ali.covers(&DrivePattern::location()));
        assert!(ali.covers(&DrivePattern::item()));
        assert!(ali.covers(&DrivePattern::avatar_location_item()));
    }

    #[test]
    fn covers_rejects_supersets_and_mismatches() {
        let ai = DrivePattern::avatar_item();
        assert!(!ai.covers(&DrivePattern::avatar_location_item()));
        assert!(!ai.covers(&DrivePattern::avatar_location()));
        assert!(!ai.covers(&DrivePattern::item_location()));
    }

    #[test]
    fn covers_respects_repeated_atoms() {
        // ALLI has two L atoms, so it covers a single-L pattern, but a
        // single-L pattern does not cover ALLI.
        let alli = DrivePattern::avatar_location_location_item();
        assert!(alli.covers(&DrivePattern::location()));
        assert!(!DrivePattern::location().covers(&alli));
        assert!(alli.covers(&DrivePattern::avatar_location_item()));
    }

    // ── Drive: decay and satisfaction ──────────────────────────────────

    #[test]
    fn recover_moves_strength_toward_baseline() {
        let mut drive = ResidentDrive::new(DrivePattern::item(), 0.8);
        drive.strength = 0.1; // far below baseline
        drive.recover_rate = 0.5; // fast

        drive.recover();

        // Exponential approach: moved halfway from 0.1 toward 0.8.
        let expected = 0.1 + (0.8 - 0.1) * 0.5;
        assert!((drive.strength - expected).abs() < 1e-6);
    }

    #[test]
    fn recover_slowly_approaches_baseline_over_many_ticks() {
        let mut drive = ResidentDrive::new(DrivePattern::item(), 1.0);
        drive.strength = 0.0;
        drive.recover_rate = 0.1;

        let mut strengths = Vec::new();
        for _ in 0..50 {
            strengths.push(drive.strength);
            drive.recover();
        }

        // Monotonically increasing toward baseline.
        for window in strengths.windows(2) {
            assert!(
                window[1] >= window[0],
                "strength must not decrease during recovery"
            );
        }
        // After 50 ticks at rate 0.1, should be very close to 1.0.
        assert!((drive.strength - 1.0).abs() < 0.01);
    }

    #[test]
    fn satisfy_drops_strength() {
        let mut drive = ResidentDrive::new(DrivePattern::avatar_item(), 0.9);
        drive.strength = 0.9;

        drive.satisfy(0.3); // drop to 30%

        assert!((drive.strength - 0.27).abs() < 1e-6);
    }

    #[test]
    fn satisfy_then_recover_creates_hunger_cycle() {
        let mut drive = ResidentDrive::new(DrivePattern::avatar_item(), 0.9);
        drive.recover_rate = 0.2;

        // Fully satisfied.
        drive.satisfy(0.0);
        assert!(drive.strength < 1e-6);

        // After recovery, hunger returns.
        for _ in 0..20 {
            drive.recover();
        }
        assert!(drive.strength > 0.5, "hunger should return after satiety");
    }

    #[test]
    fn strength_clamps_to_valid_range() {
        let mut drive = ResidentDrive::new(DrivePattern::item(), 1.0);
        drive.strength = 5.0;
        drive.recover();
        assert!(drive.strength <= 1.0);

        drive.strength = -5.0;
        drive.recover();
        assert!(drive.strength >= 0.0);
    }

    // ── Drive: bindings ────────────────────────────────────────────────

    #[test]
    fn unbound_drive_is_general_inclination() {
        let drive = ResidentDrive::new(DrivePattern::avatar_item(), 0.7);
        assert!(!drive.is_bound());
    }

    #[test]
    fn bound_drive_targets_specific_entities() {
        let drive = ResidentDrive::new(DrivePattern::avatar_location_item(), 0.9)
            .for_avatar(42)
            .at_location(7)
            .for_item(99);
        assert!(drive.is_bound());
        assert_eq!(drive.avatar_id, Some(42));
        assert_eq!(drive.location_id, Some(7));
        assert_eq!(drive.item_id, Some(99));
    }

    #[test]
    fn partially_bound_drive_is_still_bound() {
        let drive = ResidentDrive::new(DrivePattern::item(), 0.8).for_item(42);
        assert!(drive.is_bound());
    }

    // ── DriveState: collection mechanics ───────────────────────────────

    #[test]
    fn empty_state_serializes_to_nothing() {
        let state = ActorDriveState::new();
        let json = serde_json::to_string(&state).unwrap();
        // skip_serializing_if on the empty Vec means the field is omitted.
        assert_eq!(json, "{}");
    }

    #[test]
    fn recover_all_advances_every_drive() {
        let mut state = ActorDriveState::new();
        state.push(ResidentDrive::new(DrivePattern::item(), 0.8));
        state.push(ResidentDrive::new(DrivePattern::location(), 0.6));
        // Push both below baseline.
        state.drives[0].strength = 0.0;
        state.drives[1].strength = 0.0;
        state.drives[0].recover_rate = 0.5;
        state.drives[1].recover_rate = 0.5;

        state.recover_all();

        assert!(state.drives[0].strength > 0.0);
        assert!(state.drives[1].strength > 0.0);
    }

    #[test]
    fn satisfy_targets_exact_pattern_only() {
        let mut state = ActorDriveState::new();
        state.push(ResidentDrive::new(DrivePattern::avatar_item(), 0.9)); // AI
        state.push(ResidentDrive::new(DrivePattern::location(), 0.5)); // L
        state.push(ResidentDrive::new(
            DrivePattern::avatar_location_item(),
            0.9,
        )); // ALI

        // Achieving an ALI goal satisfies only the ALI drive — sub-pattern
        // drives (AI, L) represent independent inclinations and are not
        // auto-satiated.
        state.satisfy(&DrivePattern::avatar_location_item(), 0.3);

        let ai = state
            .for_pattern(&DrivePattern::avatar_item())
            .next()
            .unwrap();
        let l = state.for_pattern(&DrivePattern::location()).next().unwrap();
        let ali = state
            .for_pattern(&DrivePattern::avatar_location_item())
            .next()
            .unwrap();

        assert!(
            (ai.strength - 0.9).abs() < 1e-6,
            "AI drive should be untouched"
        );
        assert!(
            (l.strength - 0.5).abs() < 1e-6,
            "L drive should be untouched"
        );
        assert!(ali.strength < 0.9, "ALI drive should be satisfied");
    }

    #[test]
    fn strongest_returns_highest_strength() {
        let mut state = ActorDriveState::new();
        let mut low = ResidentDrive::new(DrivePattern::item(), 0.3);
        low.strength = 0.3;
        let mut high = ResidentDrive::new(DrivePattern::avatar_item(), 0.9);
        high.strength = 0.9;
        state.push(low);
        state.push(high);

        let strongest = state.strongest().unwrap();
        assert_eq!(strongest.pattern, DrivePattern::avatar_item());
    }

    #[test]
    fn urgent_filters_by_threshold() {
        let mut state = ActorDriveState::new();
        let mut d1 = ResidentDrive::new(DrivePattern::item(), 0.9);
        d1.strength = 0.9;
        let mut d2 = ResidentDrive::new(DrivePattern::location(), 0.2);
        d2.strength = 0.2;
        state.push(d1);
        state.push(d2);

        let urgent: Vec<_> = state.urgent(0.5).collect();
        assert_eq!(urgent.len(), 1);
        assert_eq!(urgent[0].pattern, DrivePattern::item());
    }

    // ── Serialization round-trip ───────────────────────────────────────

    #[test]
    fn drive_round_trips_through_serde() {
        let drive = ResidentDrive::new(DrivePattern::avatar_location_item(), 0.7)
            .for_avatar(42)
            .at_location(7)
            .for_item(99);
        let json = serde_json::to_string(&drive).unwrap();
        let restored: ResidentDrive = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.pattern, drive.pattern);
        assert!((restored.strength - drive.strength).abs() < 1e-6);
        assert_eq!(restored.avatar_id, Some(42));
        assert_eq!(restored.location_id, Some(7));
        assert_eq!(restored.item_id, Some(99));
    }

    #[test]
    fn empty_drive_state_round_trips() {
        let state = ActorDriveState::new();
        let json = serde_json::to_string(&state).unwrap();
        let restored: ActorDriveState = serde_json::from_str(&json).unwrap();
        assert!(restored.is_empty());
    }

    #[test]
    fn populated_drive_state_round_trips() {
        let mut state = ActorDriveState::new();
        state.push(ResidentDrive::new(DrivePattern::item(), 0.8).for_item(42));
        state.push(
            ResidentDrive::new(DrivePattern::avatar_location_item(), 0.6)
                .for_avatar(7)
                .at_location(3),
        );
        let json = serde_json::to_string(&state).unwrap();
        let restored: ActorDriveState = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored.drives[0].item_id, Some(42));
        assert_eq!(restored.drives[1].avatar_id, Some(7));
    }

    // ── The grammar maps to existing autonomy verbs ─────────────────────

    #[test]
    fn existing_verbs_are_implicit_drive_patterns() {
        // This test documents that the grammar names the combinations the
        // existing cascade hardcodes as separate branches. When drives
        // eventually replace the cascade, these patterns ARE the verbs.
        assert_eq!(DrivePattern::avatar_item().to_string(), "ai"); // trade, give
        assert_eq!(DrivePattern::item_location().to_string(), "il"); // seek, use_feature
        assert_eq!(DrivePattern::location().to_string(), "l"); // roam, move
        assert_eq!(DrivePattern::avatar_location_item().to_string(), "ali"); // delivery
        assert_eq!(
            DrivePattern::avatar_location_location_item().to_string(),
            "alli"
        ); // fetch-and-deliver
    }
}
