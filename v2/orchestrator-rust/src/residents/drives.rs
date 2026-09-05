#![allow(dead_code)]

use super::super::*;

use std::cmp::Ordering;
use std::fmt;
use std::str::FromStr;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DriveAtom {
    Avatar,
    Location,
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

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub(crate) struct DrivePattern {
    atoms: Vec<DriveAtom>,
}

impl DrivePattern {
    pub(crate) fn new(atoms: Vec<DriveAtom>) -> Self {
        debug_assert!(!atoms.is_empty(), "DrivePattern must be non-empty");
        Self { atoms }
    }

    pub(crate) fn avatar() -> Self {
        Self::new(vec![DriveAtom::Avatar])
    }
    pub(crate) fn location() -> Self {
        Self::new(vec![DriveAtom::Location])
    }
    pub(crate) fn item() -> Self {
        Self::new(vec![DriveAtom::Item])
    }

    pub(crate) fn avatar_item() -> Self {
        Self::new(vec![DriveAtom::Avatar, DriveAtom::Item])
    }
    pub(crate) fn avatar_location() -> Self {
        Self::new(vec![DriveAtom::Avatar, DriveAtom::Location])
    }
    pub(crate) fn item_location() -> Self {
        Self::new(vec![DriveAtom::Item, DriveAtom::Location])
    }

    pub(crate) fn avatar_location_item() -> Self {
        Self::new(vec![
            DriveAtom::Avatar,
            DriveAtom::Location,
            DriveAtom::Item,
        ])
    }

    pub(crate) fn avatar_location_location_item() -> Self {
        Self::new(vec![
            DriveAtom::Avatar,
            DriveAtom::Location,
            DriveAtom::Location,
            DriveAtom::Item,
        ])
    }

    pub(crate) fn atoms(&self) -> &[DriveAtom] {
        &self.atoms
    }

    pub(crate) fn arity(&self) -> usize {
        self.atoms.len()
    }

    pub(crate) fn contains(&self, atom: DriveAtom) -> bool {
        self.atoms.contains(&atom)
    }

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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResidentDrive {
    pub(crate) pattern: DrivePattern,
    #[serde(default = "default_strength")]
    pub(crate) strength: f32,
    #[serde(default = "default_strength")]
    pub(crate) baseline: f32,
    #[serde(default = "default_recover_rate")]
    pub(crate) recover_rate: f32,

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

    pub(crate) fn for_avatar(mut self, avatar_id: u64) -> Self {
        self.avatar_id = Some(avatar_id);
        self
    }

    pub(crate) fn at_location(mut self, location_id: u64) -> Self {
        self.location_id = Some(location_id);
        self
    }

    pub(crate) fn for_item(mut self, item_id: u64) -> Self {
        self.item_id = Some(item_id);
        self
    }

    pub(crate) fn is_bound(&self) -> bool {
        self.avatar_id.is_some() || self.location_id.is_some() || self.item_id.is_some()
    }

    pub(crate) fn recover(&mut self) {
        let delta = self.baseline - self.strength;
        self.strength += delta * self.recover_rate;
        self.strength = self.strength.clamp(0.0, 1.0);
    }

    pub(crate) fn satisfy(&mut self, factor: f32) {
        self.strength *= factor;
        self.strength = self.strength.clamp(0.0, 1.0);
    }

    pub(crate) fn is_urgent(&self, threshold: f32) -> bool {
        self.strength >= threshold
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ActorDriveState {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) drives: Vec<ResidentDrive>,
}

impl ActorDriveState {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn push(&mut self, drive: ResidentDrive) {
        self.drives.push(drive);
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.drives.is_empty()
    }

    pub(crate) fn len(&self) -> usize {
        self.drives.len()
    }

    pub(crate) fn recover_all(&mut self) {
        for drive in &mut self.drives {
            drive.recover();
        }
    }

    pub(crate) fn satisfy(&mut self, achieved: &DrivePattern, factor: f32) {
        for drive in &mut self.drives {
            if drive.pattern == *achieved {
                drive.satisfy(factor);
            }
        }
    }

    pub(crate) fn strongest(&self) -> Option<&ResidentDrive> {
        self.drives.iter().max_by(|a, b| {
            a.strength
                .partial_cmp(&b.strength)
                .unwrap_or(Ordering::Equal)
        })
    }

    pub(crate) fn for_pattern<'a>(
        &'a self,
        pattern: &DrivePattern,
    ) -> impl Iterator<Item = &'a ResidentDrive> + 'a {
        let pattern = pattern.clone();
        self.drives.iter().filter(move |d| d.pattern == pattern)
    }

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
        let alli = DrivePattern::avatar_location_location_item();
        assert!(alli.covers(&DrivePattern::location()));
        assert!(!DrivePattern::location().covers(&alli));
        assert!(alli.covers(&DrivePattern::avatar_location_item()));
    }

    #[test]
    fn recover_moves_strength_toward_baseline() {
        let mut drive = ResidentDrive::new(DrivePattern::item(), 0.8);
        drive.strength = 0.1;
        drive.recover_rate = 0.5;

        drive.recover();

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

        for window in strengths.windows(2) {
            assert!(
                window[1] >= window[0],
                "strength must not decrease during recovery"
            );
        }
        assert!((drive.strength - 1.0).abs() < 0.01);
    }

    #[test]
    fn satisfy_drops_strength() {
        let mut drive = ResidentDrive::new(DrivePattern::avatar_item(), 0.9);
        drive.strength = 0.9;

        drive.satisfy(0.3);

        assert!((drive.strength - 0.27).abs() < 1e-6);
    }

    #[test]
    fn satisfy_then_recover_creates_hunger_cycle() {
        let mut drive = ResidentDrive::new(DrivePattern::avatar_item(), 0.9);
        drive.recover_rate = 0.2;

        drive.satisfy(0.0);
        assert!(drive.strength < 1e-6);

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

    #[test]
    fn empty_state_serializes_to_nothing() {
        let state = ActorDriveState::new();
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn recover_all_advances_every_drive() {
        let mut state = ActorDriveState::new();
        state.push(ResidentDrive::new(DrivePattern::item(), 0.8));
        state.push(ResidentDrive::new(DrivePattern::location(), 0.6));
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
        state.push(ResidentDrive::new(DrivePattern::avatar_item(), 0.9));
        state.push(ResidentDrive::new(DrivePattern::location(), 0.5));
        state.push(ResidentDrive::new(
            DrivePattern::avatar_location_item(),
            0.9,
        ));

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

    #[test]
    fn existing_verbs_are_implicit_drive_patterns() {
        assert_eq!(DrivePattern::avatar_item().to_string(), "ai");
        assert_eq!(DrivePattern::item_location().to_string(), "il");
        assert_eq!(DrivePattern::location().to_string(), "l");
        assert_eq!(DrivePattern::avatar_location_item().to_string(), "ali");
        assert_eq!(
            DrivePattern::avatar_location_location_item().to_string(),
            "alli"
        );
    }
}
