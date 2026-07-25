use super::*;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct FeatureUseCandidate {
    pub(super) actor_id: u64,
    pub(super) location_id: u64,
    pub(super) feature_key: String,
    pub(super) feature_name: String,
    pub(super) item_id: u64,
    pub(super) item_name: String,
    pub(super) content: String,
    pub(super) effect: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum UseOfferKey {
    Item {
        item_id: u64,
        target_actor_id: u64,
    },
    Feature {
        item_id: u64,
        location_id: u64,
        feature_key: String,
    },
}

impl RuntimeWorld {
    fn feature_use_matches(
        &self,
        actor_id: u64,
        require_held_item: bool,
    ) -> Vec<FeatureUseCandidate> {
        let Some(actor) = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_is_active_avatar(*actor))
        else {
            return Vec::new();
        };
        let held_item_ids = self
            .actor_held_items(actor_id)
            .into_iter()
            .map(|item| item.id)
            .collect::<BTreeSet<_>>();
        let mut candidates = Vec::new();
        for feature in self.room_feature_views(actor.location_id, Some(actor_id)) {
            for use_case in feature
                .uses
                .into_iter()
                .filter(|use_case| !use_case.used)
                .filter(|use_case| !require_held_item || held_item_ids.contains(&use_case.item_id))
            {
                let effect = use_case
                    .effect
                    .filter(|effect| !effect.trim().is_empty())
                    .unwrap_or_else(|| use_case.text.clone());
                let item_name = self
                    .item_name(use_case.item_id)
                    .unwrap_or_else(|| format!("Item {}", use_case.item_id));
                candidates.push(FeatureUseCandidate {
                    actor_id,
                    location_id: actor.location_id,
                    feature_key: use_case.feature_key,
                    feature_name: feature.name.clone(),
                    item_id: use_case.item_id,
                    item_name,
                    content: use_case.text,
                    effect,
                });
            }
        }
        candidates.sort_by(|left, right| {
            left.feature_name
                .cmp(&right.feature_name)
                .then_with(|| left.feature_key.cmp(&right.feature_key))
                .then_with(|| left.item_name.cmp(&right.item_name))
                .then_with(|| left.item_id.cmp(&right.item_id))
        });
        candidates
    }

    fn feature_use_candidates(&self, actor_id: u64) -> Vec<FeatureUseCandidate> {
        self.feature_use_matches(actor_id, true)
    }

    pub(super) fn resident_feature_use_match_for_item(
        &self,
        resident: CwActor,
        item_id: u64,
    ) -> Option<FeatureUseCandidate> {
        self.feature_use_matches(resident.id, false)
            .into_iter()
            .find(|candidate| candidate.item_id == item_id)
    }

    pub(super) fn resident_feature_use_candidate(
        &self,
        resident: CwActor,
    ) -> Option<FeatureUseCandidate> {
        let mut candidates = self.feature_use_candidates(resident.id);
        candidates.sort_by_key(|candidate| {
            (
                !evolution_item_matches_resident(candidate.item_id, resident.id),
                candidate.feature_key.clone(),
                candidate.item_id,
            )
        });
        candidates.into_iter().next()
    }

    pub(super) fn default_player_feature_use_candidate(
        &self,
        actor_id: u64,
    ) -> Option<FeatureUseCandidate> {
        self.feature_use_candidates(actor_id).into_iter().next()
    }

    pub(super) fn healing_target_is_offerable(&self, actor: &CwActor, target: &CwActor) -> bool {
        if target.location_id != actor.location_id {
            return false;
        }
        let needs_healing = target.status == CW_ACTOR_KNOCKED_OUT
            || (target.status == CW_ACTOR_ACTIVE && target.damage > 0);
        if !needs_healing {
            return false;
        }
        if target.id == actor.id {
            return true;
        }
        !self.location_has_unresolved_combat(actor.location_id)
            || self.combat_actors_share_side(actor.id, target.id)
    }

    fn healing_use_choices(&self, actor_id: u64) -> Vec<(CwItem, CwActor)> {
        let Some(actor) = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_is_active_avatar(*actor))
        else {
            return Vec::new();
        };
        let preferred = self
            .resident_held_healing_item_for_target(actor)
            .map(|(item, target)| (item.id, target.id));
        let mut items = self
            .actor_held_items(actor_id)
            .into_iter()
            .filter(|item| item.kind == CW_ITEM_POTION && item.charges > 0)
            .collect::<Vec<_>>();
        items.sort_by_key(|item| (item.held_since_tick, item.id));
        let mut targets = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|target| self.healing_target_is_offerable(&actor, target))
            .collect::<Vec<_>>();
        targets.sort_by_key(|target| (target.id != actor_id, target.id));
        let mut choices = items
            .into_iter()
            .flat_map(|item| targets.iter().copied().map(move |target| (item, target)))
            .collect::<Vec<_>>();
        choices.sort_by_key(|(item, target)| {
            (
                usize::from(preferred != Some((item.id, target.id))),
                target.id != actor_id,
                target.id,
                item.held_since_tick,
                item.id,
            )
        });
        choices
    }

    pub(super) fn has_useful_usable_item(&self, actor_id: u64) -> bool {
        !self.healing_use_choices(actor_id).is_empty()
    }

    fn use_source_collectible(&self, item_id: u64) -> Option<ActionSourceCollectibleView> {
        let card = seed_card_for_subject("item", item_id).or_else(|| {
            self.materialization_receipts
                .values()
                .find(|receipt| receipt.item_id == item_id)
                .and_then(|receipt| {
                    active_content()
                        .cards
                        .iter()
                        .find(|card| card.card_id == receipt.card_id)
                        .map(card_from_seed_content)
                })
        })?;
        Some(ActionSourceCollectibleView {
            kind: "item".to_string(),
            instance_id: item_id,
            card_id: card.card_id,
            pack_id: card.pack_id.unwrap_or_else(|| "cosyworld.core".to_string()),
        })
    }

    fn retarget_use_offer(
        &self,
        actor_id: u64,
        mut offer: RankedActionOffer,
        key: UseOfferKey,
    ) -> RankedActionOffer {
        let item_id = match &key {
            UseOfferKey::Item { item_id, .. } | UseOfferKey::Feature { item_id, .. } => *item_id,
        };
        let item_name = self
            .item_name(item_id)
            .unwrap_or_else(|| format!("Item {item_id}"));
        let (legacy_id, label, command, target, effect) = match &key {
            UseOfferKey::Item {
                target_actor_id, ..
            } => {
                let target_name = self
                    .actor_name(*target_actor_id)
                    .unwrap_or_else(|| format!("Avatar {target_actor_id}"));
                (
                    format!("use_item:{item_id}:{target_actor_id}"),
                    format!("Use {item_name} on {target_name}"),
                    format!("use {item_name} on {target_name}"),
                    ActionTargetView {
                        kind: "actor".to_string(),
                        id: Some(*target_actor_id),
                        label: Some(target_name.clone()),
                    },
                    format!("{target_name} may feel steadier"),
                )
            }
            UseOfferKey::Feature {
                location_id,
                feature_key,
                ..
            } => {
                let candidate = self
                    .feature_use_candidates(actor_id)
                    .into_iter()
                    .find(|candidate| {
                        candidate.item_id == item_id
                            && candidate.location_id == *location_id
                            && candidate.feature_key == *feature_key
                    })
                    .expect("feature use offer must come from a current candidate");
                (
                    format!(
                        "use_feature:{item_id}:{location_id}:{}",
                        candidate.feature_key
                    ),
                    format!("Use {item_name} with {}", candidate.feature_name),
                    format!("use {item_name} on {}", candidate.feature_name),
                    ActionTargetView {
                        kind: "feature".to_string(),
                        id: Some(*location_id),
                        label: Some(candidate.feature_name),
                    },
                    candidate.effect,
                )
            }
        };
        offer.id = legacy_id.clone();
        offer.offer_id = format!(
            "{}:{}:{}",
            offer.rules_profile, offer.state_revision, legacy_id
        );
        offer.verb = self.action_offer_verb(&offer.kind, actor_id);
        offer.label = label.clone();
        offer.accessible_label = label;
        offer.command = normalize_command_text(&command);
        offer.provider = action_provider(
            "held_item",
            format!("item:{item_id}"),
            item_name.clone(),
            format!("From {item_name} in your hand"),
            30,
        );
        offer.target = Some(target.clone());
        offer.composition_trace.target = Some(target);
        offer.effect = Some(effect);
        if let Some(source) = self.use_source_collectible(item_id) {
            offer.source_collectible = Some(source.clone());
            offer
                .composition_trace
                .source_card_instances
                .retain(|existing| existing.kind != "item");
            offer
                .composition_trace
                .source_card_instances
                .insert(0, source);
        }
        offer
    }

    pub(super) fn expand_use_action_offers(
        &self,
        actor_id: u64,
        offers: Vec<RankedActionOffer>,
    ) -> Vec<RankedActionOffer> {
        let mut expanded = Vec::new();
        for offer in offers {
            match offer.kind.as_str() {
                "use_item" => expanded.extend(self.healing_use_choices(actor_id).into_iter().map(
                    |(item, target)| {
                        self.retarget_use_offer(
                            actor_id,
                            offer.clone(),
                            UseOfferKey::Item {
                                item_id: item.id,
                                target_actor_id: target.id,
                            },
                        )
                    },
                )),
                "use_feature" => {
                    expanded.extend(self.feature_use_candidates(actor_id).into_iter().map(
                        |candidate| {
                            self.retarget_use_offer(
                                actor_id,
                                offer.clone(),
                                UseOfferKey::Feature {
                                    item_id: candidate.item_id,
                                    location_id: candidate.location_id,
                                    feature_key: candidate.feature_key,
                                },
                            )
                        },
                    ))
                }
                _ => expanded.push(offer),
            }
        }
        expanded
    }

    fn use_offer_key(offer: &RankedActionOffer) -> Option<UseOfferKey> {
        let key = match offer.kind.as_str() {
            "use_item" => {
                let rest = offer.id.strip_prefix("use_item:")?;
                let (item_id, target_actor_id) = rest.split_once(':')?;
                UseOfferKey::Item {
                    item_id: item_id.parse().ok()?,
                    target_actor_id: target_actor_id.parse().ok()?,
                }
            }
            "use_feature" => {
                let rest = offer.id.strip_prefix("use_feature:")?;
                let mut parts = rest.splitn(3, ':');
                UseOfferKey::Feature {
                    item_id: parts.next()?.parse().ok()?,
                    location_id: parts.next()?.parse().ok()?,
                    feature_key: parts.next()?.to_string(),
                }
            }
            _ => return None,
        };
        let item_id = match &key {
            UseOfferKey::Item { item_id, .. } | UseOfferKey::Feature { item_id, .. } => *item_id,
        };
        let provider_matches = offer.provider.id == format!("item:{item_id}");
        let target_matches = match &key {
            UseOfferKey::Item {
                target_actor_id, ..
            } => offer.target.as_ref().is_some_and(|target| {
                target.kind == "actor" && target.id == Some(*target_actor_id)
            }),
            UseOfferKey::Feature { location_id, .. } => offer
                .target
                .as_ref()
                .is_some_and(|target| target.kind == "feature" && target.id == Some(*location_id)),
        };
        (provider_matches && target_matches).then_some(key)
    }

    fn current_use_offer_for_key(
        &self,
        actor_id: u64,
        expected: &UseOfferKey,
    ) -> Result<RankedActionOffer, String> {
        self.legal_action_candidates(Some(actor_id), &AccessContext::default())
            .1
            .into_iter()
            .filter(action_offer_is_reachable)
            .find(|offer| Self::use_offer_key(offer).as_ref() == Some(expected))
            .ok_or_else(|| "That Use offer is no longer current.".to_string())
    }

    pub(super) fn plan_use_item_offer_action(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
    ) -> Result<CwAction, String> {
        let offer = self
            .current_reachable_offer(actor_id, offered)
            .ok_or_else(|| "That Use offer is no longer current.".to_string())?;
        let UseOfferKey::Item {
            item_id,
            target_actor_id,
        } = Self::use_offer_key(&offer)
            .ok_or_else(|| "Use needs an exact item and avatar binding.".to_string())?
        else {
            return Err("That offer is not an item use.".to_string());
        };
        if !self
            .healing_use_choices(actor_id)
            .iter()
            .any(|(item, target)| item.id == item_id && target.id == target_actor_id)
        {
            return Err("That item or healing target is no longer available.".to_string());
        }
        let action = CwAction {
            kind: CW_ACTION_USE_ITEM,
            actor_id,
            target_actor_id,
            item_id,
            ..CwAction::default()
        };
        if !self.kernel_offer_allows_action(&action) {
            return Err("The kernel no longer offers that item use.".to_string());
        }
        Ok(action)
    }

    pub(super) fn plan_use_item_choice_action(
        &self,
        actor_id: u64,
        item_id: u64,
        target_actor_id: u64,
    ) -> Result<CwAction, String> {
        let key = UseOfferKey::Item {
            item_id,
            target_actor_id,
        };
        let offer = self.current_use_offer_for_key(actor_id, &key)?;
        self.plan_use_item_offer_action(actor_id, &offer)
    }

    pub(super) fn plan_feature_use_offer(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
    ) -> Result<FeatureUseCandidate, String> {
        let offer = self
            .current_reachable_offer(actor_id, offered)
            .ok_or_else(|| "That feature Use offer is no longer current.".to_string())?;
        let UseOfferKey::Feature {
            item_id,
            location_id,
            feature_key,
        } = Self::use_offer_key(&offer)
            .ok_or_else(|| "Use needs an exact item and room-feature binding.".to_string())?
        else {
            return Err("That offer is not a room-feature use.".to_string());
        };
        self.feature_use_candidates(actor_id)
            .into_iter()
            .find(|candidate| {
                candidate.item_id == item_id
                    && candidate.location_id == location_id
                    && candidate.feature_key == feature_key
            })
            .ok_or_else(|| "That item or room feature is no longer available.".to_string())
    }

    pub(super) fn plan_feature_use_choice(
        &self,
        actor_id: u64,
        item_id: u64,
        location_id: u64,
        feature_key: &str,
    ) -> Result<FeatureUseCandidate, String> {
        let key = UseOfferKey::Feature {
            item_id,
            location_id,
            feature_key: feature_key.to_string(),
        };
        let offer = self.current_use_offer_for_key(actor_id, &key)?;
        self.plan_feature_use_offer(actor_id, &offer)
    }

    pub(super) fn use_offer_matches_action(offer: &RankedActionOffer, action: &CwAction) -> bool {
        matches!(
            Self::use_offer_key(offer),
            Some(UseOfferKey::Item {
                item_id,
                target_actor_id,
            }) if action.kind == CW_ACTION_USE_ITEM
                && item_id == action.item_id
                && target_actor_id == action.target_actor_id
        )
    }

    pub(super) fn use_offer_matches_feature(
        offer: &RankedActionOffer,
        item_id: u64,
        location_id: u64,
        feature_key: &str,
    ) -> bool {
        matches!(
            Self::use_offer_key(offer),
            Some(UseOfferKey::Feature {
                item_id: offered_item_id,
                location_id: offered_location_id,
                feature_key: offered_feature_key,
            }) if offered_item_id == item_id
                && offered_location_id == location_id
                && offered_feature_key == feature_key
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_use_test_actor(runtime: &mut RuntimeWorld, actor_id: u64, name: &str) {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            99_000 + actor_id,
        );
        record.actor_meta_upserts.insert(
            actor_id,
            ActorMeta {
                name: name.to_string(),
                speech_mode: "prose".to_string(),
                title: "Use Tester".to_string(),
                description: "A test avatar checking exact shared item uses.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    }

    #[test]
    fn use_offers_bind_exact_choices_for_every_controller() {
        let mut runtime = RuntimeWorld::seeded();
        create_use_test_actor(&mut runtime, 5000, "Use Maker");
        create_use_test_actor(&mut runtime, 5001, "Use Target");
        for actor in &mut runtime.world.actors[..runtime.world.actor_count] {
            if matches!(actor.id, 5000 | 5001) {
                actor.damage = 1;
            }
        }
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            if matches!(item.id, HEARTH_TONIC_ITEM_ID | STORY_BUTTON_ITEM_ID) {
                item.location_id = 0;
                item.holder_actor_id = 5000;
                item.held_since_tick = runtime.world.tick;
            }
        }
        runtime.actor_autonomy.entry(5000).or_default().control_mode =
            ActorControlMode::DirectInput;

        let access = AccessContext::default();
        let direct_offers = runtime
            .legal_action_candidates(Some(5000), &access)
            .1
            .into_iter()
            .filter(|offer| matches!(offer.kind.as_str(), "use_item" | "use_feature"))
            .collect::<Vec<_>>();
        assert!(direct_offers.len() >= 3);
        assert_eq!(
            direct_offers
                .iter()
                .map(|offer| offer.offer_id.as_str())
                .collect::<BTreeSet<_>>()
                .len(),
            direct_offers.len(),
            "every exact Use choice has a unique offer identity"
        );
        assert!(direct_offers.iter().all(|offer| {
            offer.provider.kind == "held_item"
                && offer.provider.id.starts_with("item:")
                && RuntimeWorld::use_offer_key(offer).is_some()
        }));

        runtime.actor_autonomy.entry(5000).or_default().control_mode = ActorControlMode::LocalAi;
        let inference_offers = runtime
            .legal_action_candidates(Some(5000), &access)
            .1
            .into_iter()
            .filter(|offer| matches!(offer.kind.as_str(), "use_item" | "use_feature"))
            .collect::<Vec<_>>();
        assert_eq!(
            serde_json::to_value(&inference_offers).expect("inference offers serialize"),
            serde_json::to_value(&direct_offers).expect("direct offers serialize"),
            "controller mode cannot change Use enumeration or exact bindings"
        );

        let item_offer = direct_offers
            .iter()
            .find(|offer| {
                RuntimeWorld::use_offer_key(offer)
                    == Some(UseOfferKey::Item {
                        item_id: HEARTH_TONIC_ITEM_ID,
                        target_actor_id: 5000,
                    })
            })
            .expect("self-healing has an exact item offer")
            .clone();
        let item_action = runtime
            .plan_use_item_offer_action(5000, &item_offer)
            .expect("the exact item use plans");
        assert_eq!(item_action.kind, CW_ACTION_USE_ITEM);
        assert_eq!(item_action.item_id, HEARTH_TONIC_ITEM_ID);
        assert_eq!(item_action.target_actor_id, 5000);
        let actor = runtime.actor_by_id(5000).expect("Use Maker exists");
        let inferred_item_action = runtime
            .fresh_resident_autonomy_action(actor, item_action)
            .expect("inference accepts the same exact Use action");
        assert_eq!(inferred_item_action.kind, item_action.kind);
        assert_eq!(inferred_item_action.item_id, item_action.item_id);
        assert_eq!(
            inferred_item_action.target_actor_id,
            item_action.target_actor_id
        );

        let item_trace = runtime.resident_decision_trace(&ResidentAutonomyCandidate {
            actor_id: 5000,
            rank: 20,
            score: 0,
            record: JournalRecord::new(item_action, 99_100)
                .into_actor_consequence(runtime.world.tick, None),
        });
        assert_eq!(
            item_trace.choice.offer_id.as_deref(),
            Some(item_offer.offer_id.as_str())
        );

        let feature_offer = direct_offers
            .iter()
            .find(|offer| {
                matches!(
                    RuntimeWorld::use_offer_key(offer),
                    Some(UseOfferKey::Feature {
                        item_id: STORY_BUTTON_ITEM_ID,
                        location_id: COSY_COTTAGE_LOCATION_ID,
                        ..
                    })
                )
            })
            .expect("the held Story Button has an exact feature offer")
            .clone();
        let feature = runtime
            .plan_feature_use_offer(5000, &feature_offer)
            .expect("the exact feature use plans");
        let mut feature_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: 5000,
                ..CwAction::default()
            },
            99_101,
        )
        .into_actor_consequence(runtime.world.tick, None);
        feature_record
            .projection_mutations
            .push(ProjectionMutation::UseFeature {
                item_id: feature.item_id,
                location_id: feature.location_id,
                feature_key: feature.feature_key.clone(),
                content: feature.content,
                reason: "resident_feature_use".to_string(),
            });
        let feature_trace = runtime.resident_decision_trace(&ResidentAutonomyCandidate {
            actor_id: 5000,
            rank: 20,
            score: 0,
            record: feature_record.clone(),
        });
        assert_eq!(
            feature_trace.choice.offer_id.as_deref(),
            Some(feature_offer.offer_id.as_str())
        );

        let mut forged_offer = item_offer.clone();
        forged_offer.provider.id = format!("item:{STORY_BUTTON_ITEM_ID}");
        assert!(runtime
            .plan_use_item_offer_action(5000, &forged_offer)
            .is_err());

        assert_eq!(runtime.apply_journal_record(&feature_record).0, CW_OK);
        assert!(runtime
            .plan_feature_use_offer(5000, &feature_offer)
            .is_err());
        assert_eq!(
            runtime
                .apply_journal_record(&JournalRecord::new(item_action, 99_102))
                .0,
            CW_OK
        );
        assert!(runtime
            .plan_use_item_offer_action(5000, &item_offer)
            .is_err());
    }
}
