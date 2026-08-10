use super::*;

fn track_matches_actor(track: &SeedAvatarLevelTrackContent, actor: &SeedActorContent) -> bool {
    (track.actor_ids.is_empty() || track.actor_ids.contains(&actor.id))
        && track
            .actor_pack_id
            .as_ref()
            .is_none_or(|pack_id| pack_id == &actor.pack_id)
        && (track.speech_modes.is_empty() || track.speech_modes.contains(&actor.speech_mode))
}

fn event_matches_requirement(
    event: &EventView,
    actor_id: u64,
    requirement: &SeedAvatarLevelRequirementContent,
) -> bool {
    event.success
        && event.type_name == requirement.event_type
        && match requirement.actor_role.as_str() {
            "actor" => event.actor_id == Some(actor_id),
            "target" => event.target_actor_id == Some(actor_id),
            "either" => event.actor_id == Some(actor_id) || event.target_actor_id == Some(actor_id),
            _ => false,
        }
}

fn evidence_prefix(
    track: &SeedAvatarLevelTrackContent,
    actor_id: u64,
    requirement: &SeedAvatarLevelRequirementContent,
) -> String {
    format!(
        "avatar-level:evidence:{}:{actor_id}:{}:{}:",
        track.id, requirement.event_type, requirement.actor_role
    )
}

fn evidence_claim(
    track: &SeedAvatarLevelTrackContent,
    actor_id: u64,
    requirement: &SeedAvatarLevelRequirementContent,
    event: &EventView,
) -> String {
    let location_id = event
        .destination_location_id
        .or(event.location_id)
        .unwrap_or_default();
    format!(
        "{}{}:{location_id}",
        evidence_prefix(track, actor_id, requirement),
        event.seq
    )
}

fn requirement_evidence(
    claims: &BTreeSet<String>,
    track: &SeedAvatarLevelTrackContent,
    actor_id: u64,
    requirement: &SeedAvatarLevelRequirementContent,
) -> (usize, BTreeSet<u64>, u64) {
    let prefix = evidence_prefix(track, actor_id, requirement);
    let mut count = 0;
    let mut locations = BTreeSet::new();
    let mut latest_seq = 0;
    for claim in claims.iter().filter(|claim| claim.starts_with(&prefix)) {
        let mut fields = claim[prefix.len()..].split(':');
        let seq = fields
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let location_id = fields
            .next()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        count += 1;
        latest_seq = latest_seq.max(seq);
        if location_id != 0 {
            locations.insert(location_id);
        }
    }
    (count, locations, latest_seq)
}

fn requirements_are_met(
    claims: &BTreeSet<String>,
    track: &SeedAvatarLevelTrackContent,
    actor_id: u64,
    level: &SeedAvatarLevelContent,
) -> bool {
    level.requirements.iter().all(|requirement| {
        let (count, locations, _) = requirement_evidence(claims, track, actor_id, requirement);
        count >= usize::from(requirement.count)
            && locations.len() >= usize::from(requirement.distinct_locations)
    })
}

fn evidence_signature(
    claims: &BTreeSet<String>,
    track: &SeedAvatarLevelTrackContent,
    actor_id: u64,
    level: &SeedAvatarLevelContent,
) -> String {
    level
        .requirements
        .iter()
        .enumerate()
        .map(|(index, requirement)| {
            let (count, locations, latest_seq) =
                requirement_evidence(claims, track, actor_id, requirement);
            format!("{index}-{count}-{}-{latest_seq}", locations.len())
        })
        .collect::<Vec<_>>()
        .join("_")
}

impl RuntimeWorld {
    pub(super) fn avatar_level_track_for_actor(
        &self,
        actor_id: u64,
    ) -> Option<SeedAvatarLevelTrackContent> {
        let actor = active_content()
            .actors
            .iter()
            .find(|actor| actor.id == actor_id)?;
        if let Some(track_id) = actor.level_track_id.as_ref() {
            return active_content()
                .avatar_level_tracks
                .iter()
                .find(|track| &track.id == track_id)
                .cloned();
        }
        active_content()
            .avatar_level_tracks
            .iter()
            .find(|track| track_matches_actor(track, actor))
            .cloned()
    }

    pub(super) fn avatar_identity_policy(&self, actor_id: u64) -> Option<SeedActorIdentityContent> {
        let actor = active_content()
            .actors
            .iter()
            .find(|actor| actor.id == actor_id)?;
        actor
            .identity
            .clone()
            .or_else(|| {
                self.avatar_level_track_for_actor(actor_id)
                    .map(|track| track.identity)
            })
            .or_else(|| {
                Some(SeedActorIdentityContent {
                    canonical_description: actor.description.clone(),
                    ..SeedActorIdentityContent::default()
                })
            })
    }

    fn append_avatar_level_event(
        &mut self,
        type_name: &str,
        actor_id: u64,
        level: &SeedAvatarLevelContent,
        success: bool,
    ) -> EventView {
        let content = if type_name == "avatar.evolved" && !level.appearance_changes.is_empty() {
            format!(
                "{} Appearance: {}",
                level.label,
                level.appearance_changes.join(" ")
            )
        } else {
            level.label.clone()
        };
        let mut event =
            self.append_async_job_event(type_name, actor_id, Some(actor_id), Some(content));
        event.success = success;
        event.total = Some(i16::from(level.level));
        event.current_hp = self
            .actor_by_id(actor_id)
            .map(|actor| actor.stats.hp_base.saturating_sub(actor.damage).max(0));
        if let Some(logged) = self
            .event_log
            .iter_mut()
            .rev()
            .find(|logged| logged.seq == event.seq)
        {
            *logged = event.clone();
        }
        event
    }

    fn ingest_avatar_level_evidence(
        &mut self,
        track: &SeedAvatarLevelTrackContent,
        actor_id: u64,
        events: &[EventView],
    ) {
        for requirement in track
            .levels
            .iter()
            .flat_map(|level| level.requirements.iter())
        {
            for event in events
                .iter()
                .filter(|event| event_matches_requirement(event, actor_id, requirement))
            {
                self.rpg_claims
                    .insert(evidence_claim(track, actor_id, requirement, event));
            }
        }
    }

    fn apply_avatar_level_track(
        &mut self,
        track: &SeedAvatarLevelTrackContent,
        actor_id: u64,
        seed: u64,
    ) -> Vec<EventView> {
        let Some(actor_index) = self.world.actors[..self.world.actor_count]
            .iter()
            .position(|actor| actor.id == actor_id)
        else {
            return Vec::new();
        };
        let current_level = self.world.actors[actor_index].stats.level;
        if current_level >= track.max_level {
            return Vec::new();
        }
        let target_level = current_level.saturating_add(1);
        let Some(level) = track
            .levels
            .iter()
            .find(|level| level.level == target_level)
        else {
            return Vec::new();
        };
        if !requirements_are_met(&self.rpg_claims, track, actor_id, level) {
            return Vec::new();
        }

        let signature = evidence_signature(&self.rpg_claims, track, actor_id, level);
        let attempt_claim = format!(
            "avatar-level:attempt:{}:{actor_id}:{target_level}:{signature}",
            track.id
        );
        if !self.rpg_claims.insert(attempt_claim) {
            return Vec::new();
        }
        let mut events =
            vec![self.append_avatar_level_event("avatar.level_eligible", actor_id, level, true)];
        if let Some(chance) = level.chance.as_ref() {
            let check = CwAction {
                kind: CW_ACTION_ABILITY_CHECK,
                actor_id,
                location_id: self.world.actors[actor_index].location_id,
                ability: ability_from_string(&chance.ability),
                dc: chance.dc,
                ..CwAction::default()
            };
            let check_seed = seed ^ actor_id.rotate_left(17) ^ u64::from(target_level);
            let (status, mut check_events) = self.apply_action_with_seed(check, check_seed, false);
            let passed = status == CW_OK
                && check_events.iter().any(|event| {
                    event.type_name == "ability_check.rolled"
                        && event.success
                        && event
                            .total
                            .zip(event.dc)
                            .is_some_and(|(total, dc)| total >= dc)
                });
            events.append(&mut check_events);
            events.push(self.append_avatar_level_event(
                "avatar.level_attempted",
                actor_id,
                level,
                passed,
            ));
            if !passed {
                return events;
            }
        }

        let actor = &mut self.world.actors[actor_index];
        actor.stats.level = target_level;
        for effect in &level.effects {
            if effect.kind == "hp_base_delta" {
                actor.stats.hp_base = actor.stats.hp_base.saturating_add(effect.amount);
            }
        }
        events.push(self.append_avatar_level_event("avatar.evolved", actor_id, level, true));
        events
    }

    pub(super) fn apply_avatar_level_progression(
        &mut self,
        seed: u64,
        committed_events: &[EventView],
    ) -> Vec<EventView> {
        let actor_ids = committed_events
            .iter()
            .flat_map(|event| [event.actor_id, event.target_actor_id])
            .flatten()
            .collect::<BTreeSet<_>>();
        let mut projected = Vec::new();
        for actor_id in actor_ids {
            let Some(track) = self.avatar_level_track_for_actor(actor_id) else {
                continue;
            };
            self.ingest_avatar_level_evidence(&track, actor_id, committed_events);
            projected.extend(self.apply_avatar_level_track(&track, actor_id, seed));
        }
        projected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track() -> SeedAvatarLevelTrackContent {
        SeedAvatarLevelTrackContent {
            pack_id: "test".to_string(),
            id: "test.growth".to_string(),
            actor_ids: vec![42],
            actor_pack_id: None,
            speech_modes: Vec::new(),
            identity: SeedActorIdentityContent::default(),
            max_level: 3,
            levels: vec![
                SeedAvatarLevelContent {
                    level: 1,
                    label: "Awake".to_string(),
                    requirements: Vec::new(),
                    chance: None,
                    effects: Vec::new(),
                    appearance_changes: Vec::new(),
                },
                SeedAvatarLevelContent {
                    level: 2,
                    label: "Known".to_string(),
                    requirements: vec![SeedAvatarLevelRequirementContent {
                        event_type: "actor.moved".to_string(),
                        count: 2,
                        actor_role: "actor".to_string(),
                        distinct_locations: 2,
                    }],
                    chance: None,
                    effects: vec![SeedAvatarLevelEffectContent {
                        kind: "hp_base_delta".to_string(),
                        amount: 2,
                    }],
                    appearance_changes: vec!["A road-mark becomes visible.".to_string()],
                },
                SeedAvatarLevelContent {
                    level: 3,
                    label: "World-touched".to_string(),
                    requirements: vec![SeedAvatarLevelRequirementContent {
                        event_type: "item.picked_up".to_string(),
                        count: 1,
                        actor_role: "actor".to_string(),
                        distinct_locations: 0,
                    }],
                    chance: None,
                    effects: Vec::new(),
                    appearance_changes: Vec::new(),
                },
            ],
        }
    }

    fn event(seq: u64, event_type: &str, location_id: u64) -> EventView {
        EventView {
            world_id: "test".to_string(),
            world_epoch: 1,
            seq,
            type_name: event_type.to_string(),
            success: true,
            reason: 0,
            actor_id: Some(42),
            actor_name: None,
            target_actor_id: None,
            target_actor_name: None,
            location_id: Some(location_id),
            location_name: None,
            destination_location_id: None,
            destination_location_name: None,
            content_id: None,
            content: None,
            item_id: None,
            item_name: None,
            target_item_id: None,
            target_item_name: None,
            raw_roll: None,
            modifier: None,
            total: None,
            dc: None,
            damage: None,
            current_hp: None,
            combat_method: None,
            ability: None,
            clock_id: None,
            clock_scope: None,
            clock_scope_id: None,
            clock_kind: None,
            clock_label: None,
            clock_filled: None,
            clock_segments: None,
            clock_delta: None,
            tag_id: None,
            tag_scope: None,
            tag_scope_id: None,
            tag_kind: None,
            tag_label: None,
            caused_by_event_seq: None,
            source_world_tick: None,
            observed_through_seq: None,
            source_location_id: None,
            content_context: ContentReferenceContext::default(),
        }
    }

    #[test]
    fn evidence_is_distinct_and_supports_levels_above_two() {
        let track = track();
        let requirement = &track.levels[1].requirements[0];
        let mut claims = BTreeSet::new();
        claims.insert(evidence_claim(
            &track,
            42,
            requirement,
            &event(10, "actor.moved", 7),
        ));
        claims.insert(evidence_claim(
            &track,
            42,
            requirement,
            &event(11, "actor.moved", 8),
        ));
        assert!(requirements_are_met(&claims, &track, 42, &track.levels[1]));
        assert_eq!(track.levels[2].level, 3);
    }

    #[test]
    fn failed_and_chat_events_cannot_supply_evidence() {
        let requirement = SeedAvatarLevelRequirementContent {
            event_type: "actor.moved".to_string(),
            count: 1,
            actor_role: "actor".to_string(),
            distinct_locations: 0,
        };
        let mut failed = event(10, "actor.moved", 7);
        failed.success = false;
        assert!(!event_matches_requirement(&failed, 42, &requirement));
        assert!(!event_matches_requirement(
            &event(11, "message.created", 7),
            42,
            &requirement
        ));
    }

    #[test]
    fn actor_and_target_evidence_are_kept_separate() {
        let track = track();
        let mut actor_requirement = track.levels[1].requirements[0].clone();
        let mut target_requirement = actor_requirement.clone();
        actor_requirement.count = 1;
        target_requirement.count = 1;
        target_requirement.actor_role = "target".to_string();
        let movement = event(10, "actor.moved", 7);
        assert_ne!(
            evidence_claim(&track, 42, &actor_requirement, &movement),
            evidence_claim(&track, 42, &target_requirement, &movement)
        );
    }

    #[test]
    fn runtime_can_advance_an_avatar_beyond_legacy_level_two() {
        let mut runtime = RuntimeWorld::seeded();
        let actor_id = 1002;
        let actor_index = runtime.world.actors[..runtime.world.actor_count]
            .iter()
            .position(|actor| actor.id == actor_id)
            .expect("seeded avatar");
        runtime.world.actors[actor_index].stats.level = 2;
        let mut track = track();
        track.actor_ids = vec![actor_id];
        track.levels[2].requirements.clear();

        let events = runtime.apply_avatar_level_track(&track, actor_id, 77);

        assert_eq!(runtime.world.actors[actor_index].stats.level, 3);
        assert!(events
            .iter()
            .any(|event| { event.type_name == "avatar.evolved" && event.total == Some(3) }));
    }
}
