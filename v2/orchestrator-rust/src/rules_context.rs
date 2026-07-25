use super::*;
use sha2::{Digest, Sha256};

const SCENE_RULES_CONTEXT_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActionCompositionTraceView {
    pub(super) worldpack_bundle_hash: String,
    pub(super) pack_versions: Vec<ActionPackVersionView>,
    pub(super) rules_profile: String,
    pub(super) rules_pack_id: String,
    pub(super) rules_pack_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) rules_context: Option<SceneRulesContextView>,
    pub(super) source_card_instances: Vec<ActionSourceCollectibleView>,
    pub(super) target: Option<ActionTargetView>,
    pub(super) applied_variants: Vec<String>,
    pub(super) active_extensions: Vec<String>,
    pub(super) applied_reskins: Vec<String>,
    pub(super) contextual_offers: Vec<String>,
    pub(super) resolver: String,
    pub(super) state_revision: u64,
}

impl ActionCompositionTraceView {
    pub(super) fn certificate(&self) -> String {
        let bytes =
            serde_json::to_vec(self).expect("action composition trace must serialize for hashing");
        format!("sha256:{:x}", Sha256::digest(bytes))
    }
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct ActionPackVersionView {
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) integrity: String,
}

pub(super) struct ActionCompositionContributions {
    pub(super) source_card_instances: Vec<ActionSourceCollectibleView>,
    pub(super) target: Option<ActionTargetView>,
    pub(super) applied_reskins: Vec<String>,
    pub(super) contextual_offers: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct SceneRulesContextView {
    pub(super) schema_version: u8,
    pub(super) location_id: u64,
    pub(super) location_pack_id: String,
    pub(super) rules_profile: String,
    pub(super) selector_scope: String,
    pub(super) selector_id: String,
    pub(super) selected_by_pack_id: String,
    pub(super) capability_id: String,
    pub(super) provider_pack_id: String,
    pub(super) provider_pack_version: String,
    pub(super) state_revision: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct SceneRulesContextTransition {
    schema_version: u8,
    from: SceneRulesContextView,
    to: SceneRulesContextView,
}

impl SceneRulesContextView {
    fn same_ruleset(&self, other: &Self) -> bool {
        self.rules_profile == other.rules_profile
            && self.selected_by_pack_id == other.selected_by_pack_id
            && self.capability_id == other.capability_id
            && self.provider_pack_id == other.provider_pack_id
            && self.provider_pack_version == other.provider_pack_version
    }
}

impl RuntimeWorld {
    pub(super) fn action_composition_trace(
        &self,
        location_id: Option<u64>,
        state_revision: u64,
        binding: &ResolvedActionBinding,
        contributions: ActionCompositionContributions,
    ) -> ActionCompositionTraceView {
        let content = active_content();
        let rules_context = location_id
            .and_then(|location_id| self.scene_rules_context(location_id, state_revision));
        let mut contributing_pack_ids = BTreeSet::from([binding.pack_id.as_str()]);
        if let Some(context) = &rules_context {
            contributing_pack_ids.insert(context.location_pack_id.as_str());
            contributing_pack_ids.insert(context.selected_by_pack_id.as_str());
            contributing_pack_ids.insert(context.provider_pack_id.as_str());
        }
        contributing_pack_ids.extend(
            contributions
                .source_card_instances
                .iter()
                .map(|source| source.pack_id.as_str()),
        );
        ActionCompositionTraceView {
            worldpack_bundle_hash: content.manifest.bundle_hash.clone(),
            pack_versions: content
                .manifest
                .packs
                .iter()
                .filter(|pack| contributing_pack_ids.contains(pack.id.as_str()))
                .map(|pack| ActionPackVersionView {
                    pack_id: pack.id.clone(),
                    pack_version: pack.version.clone(),
                    integrity: pack.integrity.clone(),
                })
                .collect(),
            rules_profile: content.manifest.rules_profile.clone(),
            rules_pack_id: binding.pack_id.clone(),
            rules_pack_version: binding.pack_version.clone(),
            rules_context,
            source_card_instances: contributions.source_card_instances,
            target: contributions.target,
            applied_variants: content.manifest.active_rules_variants.clone(),
            active_extensions: content.manifest.active_rules_extensions.clone(),
            applied_reskins: contributions.applied_reskins,
            contextual_offers: contributions.contextual_offers,
            resolver: binding.resolver.clone(),
            state_revision,
        }
    }

    fn scene_location_pack_id(&self, location_id: u64) -> Option<String> {
        self.generated_places
            .get(&location_id)
            .map(|place| place.pack_id.clone())
            .or_else(|| {
                active_content()
                    .locations
                    .iter()
                    .find(|location| location.id == location_id)
                    .map(|location| location.pack_id.clone())
            })
            .filter(|pack_id| !pack_id.trim().is_empty())
    }

    pub(super) fn scene_rules_context(
        &self,
        location_id: u64,
        state_revision: u64,
    ) -> Option<SceneRulesContextView> {
        let location_pack_id = self.scene_location_pack_id(location_id)?;
        let authored_location = active_content()
            .locations
            .iter()
            .find(|location| location.id == location_id);
        let zone = self
            .room_sheets
            .get(&location_id)
            .map(room_sheet_zone)
            .unwrap_or_else(|| default_zone_for_scope("room", location_id));
        let selected = content_registry().active_ruleset_for_scene(
            &location_pack_id,
            zone,
            location_id,
            authored_location.and_then(|location| location.ruleset.as_deref()),
        )?;
        Some(SceneRulesContextView {
            schema_version: SCENE_RULES_CONTEXT_SCHEMA_VERSION,
            location_id,
            location_pack_id,
            rules_profile: active_content().manifest.rules_profile.clone(),
            selector_scope: selected.selector_scope,
            selector_id: selected.selector_id,
            selected_by_pack_id: selected.context.selected_by_pack_id,
            capability_id: selected.context.capability_id,
            provider_pack_id: selected.context.provider_pack_id,
            provider_pack_version: selected.context.provider_pack_version,
            state_revision,
        })
    }

    pub(super) fn apply_rules_context_transition_projection(
        &mut self,
        events: &[EventView],
    ) -> Vec<EventView> {
        let movements = events
            .iter()
            .filter(|event| event.type_name == "actor.moved" && event.success)
            .filter_map(|event| {
                Some((
                    event,
                    event.actor_id?,
                    event.location_id?,
                    event.destination_location_id?,
                ))
            })
            .collect::<Vec<_>>();
        let mut projected = Vec::new();
        for (movement, actor_id, from_location_id, to_location_id) in movements {
            let Some(from) = self.scene_rules_context(from_location_id, movement.seq) else {
                continue;
            };
            let Some(to) = self.scene_rules_context(to_location_id, movement.seq) else {
                continue;
            };
            if from.same_ruleset(&to) {
                continue;
            }
            if !self.transition_actor_rules_facet(actor_id, &from, &to, movement.seq) {
                continue;
            }

            let transition = SceneRulesContextTransition {
                schema_version: SCENE_RULES_CONTEXT_SCHEMA_VERSION,
                from,
                to: to.clone(),
            };
            let mut content_context = content_registry().content_reference_context([
                ("actor", actor_id),
                ("location", from_location_id),
                ("location", to_location_id),
            ]);
            content_context.active_rulesets = vec![ActiveRulesetContext {
                selected_by_pack_id: to.selected_by_pack_id.clone(),
                capability_id: to.capability_id.clone(),
                provider_pack_id: to.provider_pack_id.clone(),
                provider_pack_version: to.provider_pack_version.clone(),
            }];
            let event = EventView {
                seq: self.world.next_event_seq,
                type_name: "rules_context.changed".to_string(),
                success: true,
                actor_id: Some(actor_id),
                actor_name: self.actor_name(actor_id),
                location_id: Some(from_location_id),
                location_name: self.location_name(from_location_id),
                destination_location_id: Some(to_location_id),
                destination_location_name: self.location_name(to_location_id),
                content: serde_json::to_string(&transition).ok(),
                caused_by_event_seq: Some(movement.seq),
                content_context,
                ..EventView::default()
            };
            self.world.next_event_seq = self.world.next_event_seq.saturating_add(1);
            self.push_projected_event(event.clone());
            projected.push(event);
        }
        projected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_human(runtime: &mut RuntimeWorld, actor_id: u64, location_id: u64, name: &str) {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id,
                location_id,
                ..CwAction::default()
            },
            147_000 + actor_id,
        );
        record.actor_meta_upserts.insert(
            actor_id,
            ActorMeta {
                name: name.to_string(),
                speech_mode: "prose".to_string(),
                title: "Boundary Test Avatar".to_string(),
                description: "A test avatar crossing one pack boundary.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    }

    fn human_held_items(runtime: &RuntimeWorld, actor_id: u64) -> Vec<(u64, u8)> {
        runtime.world.items[..runtime.world.item_count]
            .iter()
            .filter(|item| item.holder_actor_id == actor_id)
            .map(|item| (item.id, item.zone))
            .collect()
    }

    #[test]
    fn state_and_offers_project_the_location_selected_rules_context() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Rules Context Tester",
        );

        let cottage = runtime.state_response(Some(5000), &AccessContext::default());
        let cottage_context = cottage.rules_context.expect("cottage rules context");
        assert!(!cottage.action_offers.is_empty());
        assert_eq!(cottage_context.location_pack_id, "cosyworld.core");
        assert_eq!(cottage_context.selector_scope, "pack");
        assert_eq!(cottage_context.selector_id, "cosyworld.core");
        assert_eq!(cottage_context.selected_by_pack_id, "cosyworld.core");
        assert_eq!(cottage_context.capability_id, "cosyworld.core/rules");
        assert!(cottage.action_offers.iter().all(|offer| {
            valid_sha256_digest(&offer.composition_id)
                && offer.composition_trace.worldpack_bundle_hash
                    == active_content().manifest.bundle_hash
                && !offer.composition_trace.pack_versions.is_empty()
                && offer
                    .composition_trace
                    .rules_context
                    .as_ref()
                    .is_some_and(|context| context == &cottage_context)
        }));
        let cottage_compositions = cottage
            .action_offers
            .iter()
            .map(|offer| (offer.kind.clone(), offer.composition_id.clone()))
            .collect::<BTreeMap<_, _>>();

        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("test actor")
            .location_id = 11;
        let homeroom = runtime.state_response(Some(5000), &AccessContext::default());
        let homeroom_context = homeroom.rules_context.expect("homeroom rules context");
        assert!(!homeroom.action_offers.is_empty());
        assert_eq!(homeroom_context.location_pack_id, "ruby-high.first-bell");
        assert_eq!(homeroom_context.selector_scope, "location");
        assert_eq!(
            homeroom_context.selector_id,
            "pack://ruby-high.first-bell/location/11"
        );
        assert_eq!(homeroom_context.selected_by_pack_id, "ruby-high.first-bell");
        assert_eq!(homeroom_context.capability_id, "ruby-high.first-bell/rules");
        assert!(homeroom.action_offers.iter().all(|offer| {
            valid_sha256_digest(&offer.composition_id)
                && offer
                    .composition_trace
                    .pack_versions
                    .iter()
                    .any(|pack| pack.pack_id == "ruby-high.first-bell")
                && offer
                    .composition_trace
                    .rules_context
                    .as_ref()
                    .is_some_and(|context| context == &homeroom_context)
        }));
        assert!(homeroom.action_offers.iter().any(|offer| {
            cottage_compositions
                .get(&offer.kind)
                .is_some_and(|composition_id| composition_id != &offer.composition_id)
        }));

        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("test actor")
            .location_id = 12;
        let library = runtime
            .state_response(Some(5000), &AccessContext::default())
            .rules_context
            .expect("library rules context");
        assert_eq!(library.location_pack_id, "ruby-high.first-bell");
        assert_eq!(library.selector_scope, "zone");
        assert_eq!(
            library.selector_id,
            "pack://ruby-high.first-bell/zone/sanctuary"
        );
        assert_eq!(library.capability_id, "ruby-high.first-bell/rules");

        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == 5000)
            .expect("test actor")
            .location_id = 700;
        let inherited = runtime
            .state_response(Some(5000), &AccessContext::default())
            .rules_context
            .expect("inherited rules context");
        assert_eq!(inherited.location_pack_id, "cosyworld.the-holy-land");
        assert_eq!(inherited.selected_by_pack_id, "cosyworld.core");
        assert_eq!(inherited.capability_id, "cosyworld.core/rules");
    }

    #[test]
    fn cross_pack_move_changes_context_atomically_without_moving_cards() {
        let mut base = RuntimeWorld::seeded();
        create_test_human(&mut base, 5000, COSY_COTTAGE_LOCATION_ID, "Boundary Tester");
        let held_before = human_held_items(&base, 5000);
        let item_count_before = base.world.item_count;
        let actor_meta_before =
            serde_json::to_value(base.actors.get(&5000)).expect("serialize actor identity");
        let record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_MOVE,
                actor_id: 5000,
                destination_location_id: 11,
                ..CwAction::default()
            },
            147_026,
        );

        let mut first = base.clone();
        let mut replay = base;
        let (status, events) = first.apply_journal_record(&record);
        let (replay_status, replay_events) = replay.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert_eq!(replay_status, CW_OK);
        assert_eq!(
            serde_json::to_value(&events).expect("serialize first events"),
            serde_json::to_value(&replay_events).expect("serialize replay events")
        );

        let movement = events
            .iter()
            .find(|event| event.type_name == "actor.moved")
            .expect("kernel movement commits");
        let changed = events
            .iter()
            .find(|event| event.type_name == "rules_context.changed")
            .expect("cross-pack move changes rules context");
        assert_eq!(changed.caused_by_event_seq, Some(movement.seq));
        let transition: SceneRulesContextTransition = serde_json::from_str(
            changed
                .content
                .as_deref()
                .expect("rules transition is inspectable"),
        )
        .expect("rules transition schema");
        assert_eq!(transition.from.capability_id, "cosyworld.core/rules");
        assert_eq!(transition.to.capability_id, "ruby-high.first-bell/rules");
        assert_eq!(changed.content_context.active_rulesets.len(), 1);
        let persisted_context = &changed.content_context.active_rulesets[0];
        assert_eq!(
            persisted_context.selected_by_pack_id,
            transition.to.selected_by_pack_id
        );
        assert_eq!(persisted_context.capability_id, transition.to.capability_id);
        assert_eq!(
            persisted_context.provider_pack_id,
            transition.to.provider_pack_id
        );
        assert_eq!(
            persisted_context.provider_pack_version,
            transition.to.provider_pack_version
        );

        let state = first.state_response(Some(5000), &AccessContext::default());
        assert_eq!(state.location.id, 11);
        assert_eq!(
            state
                .rules_context
                .as_ref()
                .map(|context| context.capability_id.as_str()),
            Some("ruby-high.first-bell/rules")
        );
        assert_eq!(first.world.item_count, item_count_before);
        assert_eq!(human_held_items(&first, 5000), held_before);
        assert_eq!(
            serde_json::to_value(first.actors.get(&5000)).expect("serialize actor identity"),
            actor_meta_before
        );
    }
}
