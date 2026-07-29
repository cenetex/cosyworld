use crate::*;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub(crate) enum EffectDescriptor {
    AdvanceClock {
        clock_id: String,
        amount: u8,
        #[serde(default)]
        reason: Option<String>,
    },
    SetTag {
        tag_id: String,
        scope: String,
        scope_id: u64,
        label: String,
        kind: String,
        #[serde(default)]
        expires: Option<String>,
        #[serde(default)]
        reason: Option<String>,
    },
    ClearTag {
        tag_id: String,
        #[serde(default)]
        reason: Option<String>,
    },
    SetJobStatus {
        job_id: String,
        status: String,
        #[serde(default)]
        reason: Option<String>,
    },
    UnlockExit {
        from_location_id: u64,
        to_location_id: u64,
        #[serde(default)]
        reason: Option<String>,
    },
    RevealItem {
        item_id: u64,
        location_id: u64,
        #[serde(default)]
        reason: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum EffectApplicationSource<'a> {
    Lifecycle(&'a str),
    ClockFill(&'a str),
    JobContribution,
}

pub(crate) fn lifecycle_hook_requirements_met(
    hook: &SeedLifecycleHookContent,
    tags: &BTreeMap<String, RpgTagState>,
) -> bool {
    hook.requirements.iter().all(|requirement| {
        requirement.kind == "active_tag"
            && tags.get(&requirement.tag_id).is_some_and(|tag| tag.active)
    })
}

impl<'a> EffectApplicationSource<'a> {
    fn default_reason(self) -> &'static str {
        match self {
            Self::Lifecycle(_) => "lifecycle_effect",
            Self::ClockFill(_) => "clock_fill",
            Self::JobContribution => "job_contribution",
        }
    }

    fn authored_reason(self) -> Option<&'a str> {
        match self {
            Self::Lifecycle(hook_name) => Some(hook_name),
            Self::ClockFill(_) | Self::JobContribution => None,
        }
    }

    fn clock_id(self) -> Option<&'a str> {
        match self {
            Self::ClockFill(clock_id) => Some(clock_id),
            Self::Lifecycle(_) | Self::JobContribution => None,
        }
    }
}

impl RuntimeWorld {
    pub(crate) fn apply_effects(
        &mut self,
        source: EffectApplicationSource<'_>,
        actor_id: u64,
        source_event_seq: u64,
        effects: &[EffectDescriptor],
    ) -> Vec<EventView> {
        if effects.is_empty() {
            return Vec::new();
        }
        if let Err(error) = self.validate_runtime_effects(effects) {
            let Some(clock_id) = source.clock_id() else {
                return Vec::new();
            };
            return self
                .clocks
                .get(clock_id)
                .cloned()
                .map_or_else(Vec::new, |clock| {
                    vec![self.append_clock_event(
                        "clock.fill_effect_rejected",
                        actor_id,
                        &clock,
                        0,
                        &error,
                    )]
                });
        }

        let mut events = Vec::new();
        for effect in effects {
            let reason = effect_descriptor_reason(effect)
                .or_else(|| source.authored_reason())
                .unwrap_or_else(|| source.default_reason());
            let mut authoritative_status = None;
            match effect {
                EffectDescriptor::AdvanceClock {
                    clock_id,
                    amount,
                    reason: _,
                } => events.extend(self.advance_clock(clock_id, *amount, actor_id, reason)),
                EffectDescriptor::SetTag {
                    tag_id,
                    scope,
                    scope_id,
                    label,
                    kind,
                    expires,
                    reason: _,
                } => {
                    let tag = RpgTagState {
                        id: tag_id.clone(),
                        scope: scope.clone(),
                        scope_id: *scope_id,
                        label: label.clone(),
                        kind: kind.clone(),
                        active: true,
                        source_event_seq: Some(source_event_seq),
                        expires: expires.clone(),
                    };
                    if let Some(event) = self.set_rpg_tag(tag, actor_id, reason) {
                        events.push(event);
                    }
                }
                EffectDescriptor::ClearTag { tag_id, reason: _ } => {
                    if let Some(event) = self.clear_rpg_tag(tag_id, actor_id, reason) {
                        events.push(event);
                    }
                }
                EffectDescriptor::SetJobStatus {
                    job_id,
                    status,
                    reason: _,
                } => {
                    events.extend(self.set_job_status_events(job_id, status, actor_id, reason));
                }
                EffectDescriptor::UnlockExit {
                    from_location_id,
                    to_location_id,
                    reason: _,
                } => {
                    let (status, routed_events) = self.apply_action_with_seed(
                        CwAction {
                            kind: CW_ACTION_UNLOCK_EXIT,
                            actor_id,
                            location_id: *from_location_id,
                            destination_location_id: *to_location_id,
                            ..CwAction::default()
                        },
                        source_event_seq,
                        false,
                    );
                    if status == CW_OK {
                        let unlock_event_seq = routed_events
                            .iter()
                            .find(|event| {
                                event.success
                                    && event.type_name == "exit.unlocked"
                                    && event.location_id == Some(*from_location_id)
                                    && event.destination_location_id == Some(*to_location_id)
                            })
                            .map(|event| event.seq)
                            .unwrap_or(source_event_seq);
                        let recorded = self.record_authored_route_unlock(
                            *from_location_id,
                            *to_location_id,
                            actor_id,
                            unlock_event_seq,
                            reason,
                        );
                        debug_assert!(
                            recorded,
                            "validated authored exit unlock must update its canonical route"
                        );
                    }
                    events.extend(routed_events);
                    authoritative_status = Some(status);
                }
                EffectDescriptor::RevealItem {
                    item_id,
                    location_id,
                    reason: _,
                } => {
                    let (status, routed_events) = self.apply_action_with_seed(
                        CwAction {
                            kind: CW_ACTION_REVEAL_ITEM,
                            actor_id,
                            location_id: *location_id,
                            item_id: *item_id,
                            ..CwAction::default()
                        },
                        source_event_seq,
                        false,
                    );
                    events.extend(routed_events);
                    authoritative_status = Some(status);
                }
                EffectDescriptor::Unknown => unreachable!("unknown effects fail staged validation"),
            }
            if authoritative_status.is_some_and(|status| status != CW_OK) {
                if let Some(clock_id) = source.clock_id() {
                    if let Some(clock) = self.clocks.get(clock_id).cloned() {
                        events.push(self.append_clock_event(
                            "clock.fill_effect_partial",
                            actor_id,
                            &clock,
                            0,
                            &format!("{} rejected by the kernel", summarize_effect(effect)),
                        ));
                    }
                }
                break;
            }
        }
        events
    }

    fn validate_runtime_effects(&self, effects: &[EffectDescriptor]) -> Result<(), String> {
        for effect in effects {
            match effect {
                EffectDescriptor::AdvanceClock {
                    clock_id, amount, ..
                } => {
                    let Some(clock) = self.clocks.get(clock_id) else {
                        return Err(format!("missing clock {clock_id}"));
                    };
                    if *amount == 0 || *amount > clock.segments.max(1) {
                        return Err(format!("invalid clock amount {amount} for {clock_id}"));
                    }
                }
                EffectDescriptor::SetTag {
                    tag_id,
                    scope,
                    scope_id,
                    label,
                    kind,
                    ..
                } => {
                    if tag_id.trim().is_empty() || label.trim().is_empty() {
                        return Err("tag id and label are required".to_string());
                    }
                    if !tag_scope_is_allowed(scope) || !tag_kind_is_allowed(kind) {
                        return Err(format!("invalid tag {scope}/{kind}"));
                    }
                    if scope == "actor" && self.actor_by_id(*scope_id).is_none() {
                        return Err(format!("missing actor {scope_id}"));
                    }
                    if scope == "room" && self.location_name(*scope_id).is_none() {
                        return Err(format!("missing room {scope_id}"));
                    }
                }
                EffectDescriptor::ClearTag { tag_id, .. } => {
                    if !self.tags.contains_key(tag_id) {
                        return Err(format!("missing tag {tag_id}"));
                    }
                }
                EffectDescriptor::SetJobStatus { job_id, status, .. } => {
                    let Some(job) = self.jobs.get(job_id) else {
                        return Err(format!("missing job {job_id}"));
                    };
                    let next = normalize_job_status(status)
                        .ok_or_else(|| format!("invalid job status {status}"))?;
                    let current = job.status.trim();
                    if matches!(current, "completed" | "failed") && current != next {
                        return Err(format!("illegal job status transition {current}->{next}"));
                    }
                }
                EffectDescriptor::UnlockExit {
                    from_location_id,
                    to_location_id,
                    ..
                } => {
                    let Some(exit) =
                        self.world.exits[..self.world.exit_count]
                            .iter()
                            .find(|exit| {
                                exit.from_location_id == *from_location_id
                                    && exit.to_location_id == *to_location_id
                            })
                    else {
                        return Err(format!("missing exit {from_location_id}->{to_location_id}"));
                    };
                    if exit.flags & CW_EXIT_LOCKED == 0 {
                        return Err(format!(
                            "exit {from_location_id}->{to_location_id} is already unlocked"
                        ));
                    }
                    if !self.authored_route_locked_for_edge(*from_location_id, *to_location_id) {
                        return Err(format!(
                            "exit {from_location_id}->{to_location_id} is not an authored locked route"
                        ));
                    }
                }
                EffectDescriptor::RevealItem {
                    item_id,
                    location_id,
                    ..
                } => {
                    if !active_content()
                        .items
                        .iter()
                        .any(|item| item.id == *item_id)
                    {
                        return Err(format!("missing item template {item_id}"));
                    }
                    let Some(item) = self.world.items[..self.world.item_count]
                        .iter()
                        .find(|item| item.id == *item_id)
                    else {
                        return Err(format!("missing item {item_id}"));
                    };
                    if self.location_name(*location_id).is_none() {
                        return Err(format!("missing room {location_id}"));
                    }
                    if item.holder_actor_id != 0 || item.location_id != 0 || item.charges == 0 {
                        return Err(format!("item {item_id} is not hidden"));
                    }
                    if !self.room_floor_empty(*location_id) {
                        return Err(format!("room {location_id} floor is full"));
                    }
                }
                EffectDescriptor::Unknown => {
                    return Err("unknown effect op".to_string());
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn effect_descriptor_reason(effect: &EffectDescriptor) -> Option<&str> {
    match effect {
        EffectDescriptor::AdvanceClock { reason, .. }
        | EffectDescriptor::SetTag { reason, .. }
        | EffectDescriptor::ClearTag { reason, .. }
        | EffectDescriptor::SetJobStatus { reason, .. }
        | EffectDescriptor::UnlockExit { reason, .. }
        | EffectDescriptor::RevealItem { reason, .. } => reason.as_deref(),
        EffectDescriptor::Unknown => None,
    }
}

pub(crate) fn summarize_effects(effects: &[EffectDescriptor]) -> Option<String> {
    let parts: Vec<_> = effects.iter().map(summarize_effect).collect();
    (!parts.is_empty()).then(|| parts.join("; "))
}

fn summarize_effect(effect: &EffectDescriptor) -> String {
    let summary = match effect {
        EffectDescriptor::AdvanceClock {
            clock_id, amount, ..
        } => format!("advances {clock_id} by {amount}"),
        EffectDescriptor::SetTag {
            scope,
            scope_id,
            label,
            ..
        } => format!("sets {scope} tag {label} on {scope_id}"),
        EffectDescriptor::ClearTag { tag_id, .. } => format!("clears tag {tag_id}"),
        EffectDescriptor::SetJobStatus { job_id, status, .. } => {
            let status = normalize_job_status(status).unwrap_or(status);
            format!("sets job {job_id} to {status}")
        }
        EffectDescriptor::UnlockExit {
            from_location_id,
            to_location_id,
            ..
        } => format!("unlocks exit {from_location_id}->{to_location_id}"),
        EffectDescriptor::RevealItem {
            item_id,
            location_id,
            ..
        } => format!("reveals item {item_id} in {location_id}"),
        EffectDescriptor::Unknown => "unknown effect".to_string(),
    };
    if let Some(reason) = effect_descriptor_reason(effect)
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
    {
        format!("{summary} ({reason})")
    } else {
        summary
    }
}

#[cfg(test)]
pub(crate) fn insert_effect_test_clock(
    runtime: &mut RuntimeWorld,
    clock_id: &str,
    effects: Vec<EffectDescriptor>,
) {
    runtime.clocks.insert(
        clock_id.to_string(),
        ClockState {
            id: clock_id.to_string(),
            scope: "room".to_string(),
            scope_id: COSY_COTTAGE_LOCATION_ID,
            kind: "exploration".to_string(),
            zone: ZONE_SANCTUARY.to_string(),
            label: "Test world effect".to_string(),
            segments: 1,
            filled: 0,
            visible_to_players: true,
            status: "active".to_string(),
            presentation: ClockPresentation::default(),
            on_fill: effects,
            recent_contributions: Vec::new(),
            completion: None,
            created_event_seq: None,
            updated_event_seq: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_hook_active_tag_requirement_tracks_durable_tag_state() {
        let hook = SeedLifecycleHookContent {
            hook: "on_use".to_string(),
            target_kind: "item".to_string(),
            target_id: "2005".to_string(),
            claim_scope: "world_target_once".to_string(),
            requirements: vec![SeedLifecycleRequirementContent {
                kind: "active_tag".to_string(),
                tag_id: "room:1:test_gate_open".to_string(),
            }],
            effects: Vec::new(),
        };
        let mut tags = BTreeMap::new();
        assert!(!lifecycle_hook_requirements_met(&hook, &tags));
        tags.insert(
            "room:1:test_gate_open".to_string(),
            RpgTagState {
                id: "room:1:test_gate_open".to_string(),
                scope: "room".to_string(),
                scope_id: COSY_COTTAGE_LOCATION_ID,
                label: "test gate open".to_string(),
                kind: "memory".to_string(),
                active: true,
                source_event_seq: None,
                expires: None,
            },
        );
        assert!(lifecycle_hook_requirements_met(&hook, &tags));
        tags.get_mut("room:1:test_gate_open")
            .expect("test tag remains present")
            .active = false;
        assert!(!lifecycle_hook_requirements_met(&hook, &tags));
    }
}
