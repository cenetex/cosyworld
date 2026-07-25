use super::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TransferOfferKey {
    item_id: u64,
    target_actor_id: u64,
    target_item_id: u64,
}

impl RuntimeWorld {
    pub(super) fn has_actor_gift(&self, actor_id: u64) -> bool {
        self.actor_give_candidate(actor_id).is_some()
    }

    pub(super) fn actor_give_candidate(&self, actor_id: u64) -> Option<(CwItem, CwActor)> {
        let actor = self.actor_by_id(actor_id)?;
        Self::actor_is_active_avatar(actor).then_some(())?;
        self.default_actor_gift_candidate(actor_id)
            .map(|candidate| (candidate.offered_item, candidate.target))
            .or_else(|| {
                self.resident_gift_candidate(actor)
                    .map(|candidate| (candidate.actor_item, candidate.target))
            })
            .or_else(|| {
                let mut held_items = self.actor_held_items(actor_id);
                held_items.sort_by_key(|item| item.id);
                let mut targets = self.active_chat_targets(actor_id);
                targets.sort_by_key(|target| target.id);
                held_items.into_iter().find_map(|item| {
                    targets
                        .iter()
                        .copied()
                        .find(|target| self.actor_can_receive_item(*target, item.id))
                        .map(|target| (item, target))
                })
            })
    }

    pub(super) fn default_item_trade(&self, actor_id: u64) -> Option<(CwItem, CwActor, CwItem)> {
        self.default_item_trade_candidate(actor_id)
            .map(|candidate| {
                (
                    candidate.offered_item,
                    candidate.target,
                    candidate.target_item,
                )
            })
    }

    fn gift_offer_choices(&self, actor_id: u64) -> Vec<(CwItem, CwActor)> {
        let Some(actor) = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_is_active_avatar(*actor))
        else {
            return Vec::new();
        };
        let preferred = self
            .actor_give_candidate(actor_id)
            .map(|(item, target)| (item.id, target.id));
        let mut choices = Vec::new();
        for item in self.actor_held_items(actor.id) {
            for target in self.active_chat_targets(actor.id) {
                if self
                    .actor_gift_is_legal(actor.id, target.id, item.id)
                    .is_ok()
                {
                    choices.push((item, target));
                }
            }
        }
        choices.sort_by_key(|(item, target)| {
            (
                usize::from(preferred != Some((item.id, target.id))),
                target.id,
                item.id,
            )
        });
        choices
    }

    fn transfer_offer_key(offer: &RankedActionOffer) -> Option<TransferOfferKey> {
        let parts = offer.id.split(':').collect::<Vec<_>>();
        let key = match parts.as_slice() {
            ["give_item", item_id, target_actor_id] => TransferOfferKey {
                item_id: item_id.parse().ok()?,
                target_actor_id: target_actor_id.parse().ok()?,
                target_item_id: 0,
            },
            ["trade_item", item_id, target_actor_id, target_item_id] => TransferOfferKey {
                item_id: item_id.parse().ok()?,
                target_actor_id: target_actor_id.parse().ok()?,
                target_item_id: target_item_id.parse().ok()?,
            },
            _ => return None,
        };
        let provider_matches =
            offer.provider.kind == "item" && offer.provider.id == format!("item:{}", key.item_id);
        let target_matches = match offer.kind.as_str() {
            "give_item" => offer.target.as_ref().is_some_and(|target| {
                target.kind == "actor" && target.id == Some(key.target_actor_id)
            }),
            "trade_item" => offer.target.as_ref().is_some_and(|target| {
                target.kind == "item" && target.id == Some(key.target_item_id)
            }),
            _ => false,
        };
        (provider_matches && target_matches).then_some(key)
    }

    fn retarget_transfer_action_offer(
        &self,
        actor_id: u64,
        mut offer: RankedActionOffer,
        key: TransferOfferKey,
        effect: String,
    ) -> RankedActionOffer {
        let item_name = self
            .item_name(key.item_id)
            .unwrap_or_else(|| format!("Item {}", key.item_id));
        let target_name = self
            .actor_name(key.target_actor_id)
            .unwrap_or_else(|| format!("Avatar {}", key.target_actor_id));
        let (legacy_id, label, command, target) = if offer.kind == "give_item" {
            (
                format!("give_item:{}:{}", key.item_id, key.target_actor_id),
                format!("Give {item_name} to {target_name}"),
                format!("give {item_name} to {target_name}"),
                ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(key.target_actor_id),
                    label: Some(target_name),
                },
            )
        } else {
            let target_item_name = self
                .item_name(key.target_item_id)
                .unwrap_or_else(|| format!("Item {}", key.target_item_id));
            (
                format!(
                    "trade_item:{}:{}:{}",
                    key.item_id, key.target_actor_id, key.target_item_id
                ),
                format!("Trade {item_name} to {target_name} for {target_item_name}"),
                format!("trade {item_name} with {target_name} for {target_item_name}"),
                ActionTargetView {
                    kind: "item".to_string(),
                    id: Some(key.target_item_id),
                    label: Some(format!("{target_item_name} from {target_name}")),
                },
            )
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
            "item",
            format!("item:{}", key.item_id),
            item_name,
            "This carried item makes the exact transfer available",
            20,
        );
        offer.target = Some(target.clone());
        offer.composition_trace.target = Some(target);
        offer.effect = Some(effect);
        if let Some(source) = self.item_source_collectible(key.item_id) {
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

    fn gift_offer_effect(&self, actor_id: u64, item: CwItem, target: CwActor) -> String {
        let item_name = self
            .item_name(item.id)
            .unwrap_or_else(|| format!("Item {}", item.id));
        let target_name = self
            .actor_name(target.id)
            .unwrap_or_else(|| format!("Avatar {}", target.id));
        if self.actor_control_mode(target.id).is_direct_input() {
            return format!("offers {item_name} to {target_name} for approval");
        }
        let reason = self
            .resident_request_for_holder(target, actor_id)
            .filter(|request| request.item_id == item.id)
            .map(|request| request.reason)
            .unwrap_or_else(|| format!("{target_name} can receive {item_name}"));
        let reason = reason.trim_end_matches('.');
        if let Some(return_item) = self.resident_player_gift_return_item(target, item) {
            let return_name = self
                .item_name(return_item.id)
                .unwrap_or_else(|| format!("Item {}", return_item.id));
            format!(
                "{reason}; offers {item_name} to {target_name}; {target_name} hands you {return_name} to make room"
            )
        } else {
            format!("{reason}; offers {item_name} to {target_name}")
        }
    }

    pub(super) fn expand_transfer_action_offers(
        &self,
        actor_id: u64,
        offers: Vec<RankedActionOffer>,
    ) -> Vec<RankedActionOffer> {
        let mut expanded = Vec::new();
        for offer in offers {
            match offer.kind.as_str() {
                "give_item" => {
                    expanded.extend(self.gift_offer_choices(actor_id).into_iter().map(
                        |(item, target)| {
                            let effect = self.gift_offer_effect(actor_id, item, target);
                            self.retarget_transfer_action_offer(
                                actor_id,
                                offer.clone(),
                                TransferOfferKey {
                                    item_id: item.id,
                                    target_actor_id: target.id,
                                    target_item_id: 0,
                                },
                                effect,
                            )
                        },
                    ));
                }
                "trade_item" => {
                    expanded.extend(
                        self.accepted_item_trade_candidates(actor_id)
                            .into_iter()
                            .map(|candidate| {
                                let effect = if self
                                    .actor_control_mode(candidate.target.id)
                                    .is_direct_input()
                                {
                                    format!(
                                        "asks {} to approve this exact exchange",
                                        self.actor_name(candidate.target.id).unwrap_or_else(|| {
                                            format!("Avatar {}", candidate.target.id)
                                        })
                                    )
                                } else {
                                    candidate.preference.reason
                                };
                                self.retarget_transfer_action_offer(
                                    actor_id,
                                    offer.clone(),
                                    TransferOfferKey {
                                        item_id: candidate.offered_item.id,
                                        target_actor_id: candidate.target.id,
                                        target_item_id: candidate.target_item.id,
                                    },
                                    effect,
                                )
                            }),
                    );
                }
                _ => expanded.push(offer),
            }
        }
        expanded
    }

    fn current_transfer_offer_for_choice(
        &self,
        actor_id: u64,
        kind: &str,
        key: TransferOfferKey,
    ) -> Result<RankedActionOffer, String> {
        self.legal_action_candidates(Some(actor_id), &AccessContext::default())
            .1
            .into_iter()
            .filter(action_offer_is_reachable)
            .find(|offer| offer.kind == kind && Self::transfer_offer_key(offer) == Some(key))
            .ok_or_else(|| format!("That {kind} offer is no longer current."))
    }

    pub(super) fn plan_transfer_offer_action(
        &self,
        actor_id: u64,
        offered: &RankedActionOffer,
    ) -> Result<CwAction, String> {
        if !matches!(offered.kind.as_str(), "give_item" | "trade_item")
            || !action_offer_is_reachable(offered)
        {
            return Err("Transfer needs a current reachable offer.".to_string());
        }
        let offer = self
            .current_reachable_offer(actor_id, offered)
            .ok_or_else(|| "That transfer offer is no longer current.".to_string())?;
        let key = Self::transfer_offer_key(&offer)
            .ok_or_else(|| "Transfer offer has no exact item and avatar binding.".to_string())?;
        let action = match offer.kind.as_str() {
            "give_item" => {
                self.actor_gift_is_legal(actor_id, key.target_actor_id, key.item_id)?;
                let target_item_id = self
                    .actor_by_id(key.target_actor_id)
                    .zip(self.item_by_id(key.item_id))
                    .filter(|(target, _)| !self.actor_control_mode(target.id).is_direct_input())
                    .and_then(|(target, item)| self.resident_player_gift_return_item(target, item))
                    .map(|item| item.id)
                    .unwrap_or(0);
                CwAction {
                    kind: CW_ACTION_GIVE_ITEM,
                    actor_id,
                    target_actor_id: key.target_actor_id,
                    item_id: key.item_id,
                    target_item_id,
                    ..CwAction::default()
                }
            }
            "trade_item" => {
                self.actor_trade_is_legal(
                    actor_id,
                    key.target_actor_id,
                    key.item_id,
                    key.target_item_id,
                )?;
                if !self
                    .actor_control_mode(key.target_actor_id)
                    .is_direct_input()
                {
                    self.resident_trade_is_willing(
                        actor_id,
                        key.target_actor_id,
                        key.item_id,
                        key.target_item_id,
                    )?;
                }
                CwAction {
                    kind: CW_ACTION_TRADE_ITEM,
                    actor_id,
                    target_actor_id: key.target_actor_id,
                    item_id: key.item_id,
                    target_item_id: key.target_item_id,
                    ..CwAction::default()
                }
            }
            _ => unreachable!(),
        };
        if !self.kernel_offer_allows_action(&action) {
            return Err("The kernel no longer offers that transfer.".to_string());
        }
        Ok(action)
    }

    pub(super) fn plan_transfer_choice_action(
        &self,
        actor_id: u64,
        kind: &str,
        item_id: u64,
        target_actor_id: u64,
        target_item_id: u64,
    ) -> Result<CwAction, String> {
        let key = TransferOfferKey {
            item_id,
            target_actor_id,
            target_item_id,
        };
        let offer = self.current_transfer_offer_for_choice(actor_id, kind, key)?;
        self.plan_transfer_offer_action(actor_id, &offer)
    }

    pub(super) fn transfer_offer_matches_action(
        offer: &RankedActionOffer,
        action: &CwAction,
    ) -> bool {
        let Some(key) = Self::transfer_offer_key(offer) else {
            return false;
        };
        match action.kind {
            CW_ACTION_GIVE_ITEM => {
                offer.kind == "give_item"
                    && key.item_id == action.item_id
                    && key.target_actor_id == action.target_actor_id
            }
            CW_ACTION_TRADE_ITEM => {
                offer.kind == "trade_item"
                    && key.item_id == action.item_id
                    && key.target_actor_id == action.target_actor_id
                    && key.target_item_id == action.target_item_id
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_transfer_test_actor(runtime: &mut RuntimeWorld, actor_id: u64, name: &str) {
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_CREATE_ACTOR,
                actor_id,
                location_id: COSY_COTTAGE_LOCATION_ID,
                ..CwAction::default()
            },
            98_000 + actor_id,
        );
        record.actor_meta_upserts.insert(
            actor_id,
            ActorMeta {
                name: name.to_string(),
                speech_mode: "prose".to_string(),
                title: "Transfer Tester".to_string(),
                description: "A test avatar checking exact shared transfers.".to_string(),
            },
        );
        assert_eq!(runtime.apply_journal_record(&record).0, CW_OK);
    }

    #[test]
    fn transfer_offers_bind_exact_choices_for_every_controller() {
        let mut runtime = RuntimeWorld::seeded();
        create_transfer_test_actor(&mut runtime, 5000, "Offer Maker");
        create_transfer_test_actor(&mut runtime, 5001, "Offer Decider");
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            let holder_actor_id = match item.id {
                STORY_BUTTON_ITEM_ID => Some(5000),
                WATCH_BELL_ITEM_ID => Some(5001),
                DEWBRIGHT_BUTTON_ITEM_ID => Some(RATI_ACTOR_ID),
                _ => None,
            };
            if let Some(holder_actor_id) = holder_actor_id {
                item.location_id = 0;
                item.holder_actor_id = holder_actor_id;
                item.held_since_tick = runtime.world.tick;
            }
        }
        runtime.record_economy_disclosure(5000, 5001);
        runtime.record_economy_disclosure(5000, RATI_ACTOR_ID);
        runtime.actor_autonomy.entry(5000).or_default().control_mode =
            ActorControlMode::DirectInput;
        runtime.actor_autonomy.entry(5001).or_default().control_mode =
            ActorControlMode::DirectInput;

        let access = AccessContext::default();
        let direct_offers = runtime
            .legal_action_candidates(Some(5000), &access)
            .1
            .into_iter()
            .filter(|offer| matches!(offer.kind.as_str(), "give_item" | "trade_item"))
            .collect::<Vec<_>>();
        assert!(direct_offers.len() >= 3);
        assert_eq!(
            direct_offers
                .iter()
                .map(|offer| offer.offer_id.as_str())
                .collect::<BTreeSet<_>>()
                .len(),
            direct_offers.len(),
            "every exact transfer has a unique offer identity"
        );
        assert!(direct_offers.iter().all(|offer| {
            let Some(key) = RuntimeWorld::transfer_offer_key(offer) else {
                return false;
            };
            offer.provider.kind == "item"
                && offer.provider.id == format!("item:{}", key.item_id)
                && offer
                    .source_collectible
                    .as_ref()
                    .is_some_and(|source| source.instance_id == key.item_id)
                && offer
                    .composition_trace
                    .source_card_instances
                    .iter()
                    .any(|source| source.kind == "item" && source.instance_id == key.item_id)
        }));
        let action_hand = compose_action_hand(&direct_offers);
        for kind in ["give_item", "trade_item"] {
            assert!(
                action_hand
                    .entries
                    .iter()
                    .filter(|entry| entry.kind == kind)
                    .count()
                    <= 1,
                "exact choices stay available without duplicating a verb in the action hand"
            );
        }

        runtime.actor_autonomy.entry(5000).or_default().control_mode = ActorControlMode::LocalAi;
        let inference_offers = runtime
            .legal_action_candidates(Some(5000), &access)
            .1
            .into_iter()
            .filter(|offer| matches!(offer.kind.as_str(), "give_item" | "trade_item"))
            .collect::<Vec<_>>();
        assert_eq!(
            serde_json::to_value(&inference_offers).expect("inference offers serialize"),
            serde_json::to_value(&direct_offers).expect("direct offers serialize"),
            "controller mode cannot change transfer enumeration or exact bindings"
        );

        let direct_gift_offer = direct_offers
            .iter()
            .find(|offer| {
                RuntimeWorld::transfer_offer_key(offer)
                    == Some(TransferOfferKey {
                        item_id: STORY_BUTTON_ITEM_ID,
                        target_actor_id: 5001,
                        target_item_id: 0,
                    })
            })
            .expect("the direct target has an exact gift offer")
            .clone();
        let direct_gift = runtime
            .plan_transfer_offer_action(5000, &direct_gift_offer)
            .expect("the exact gift plans");
        assert_eq!(direct_gift.kind, CW_ACTION_GIVE_ITEM);
        assert_eq!(direct_gift.item_id, STORY_BUTTON_ITEM_ID);
        assert_eq!(direct_gift.target_actor_id, 5001);

        let direct_trade_offer = direct_offers
            .iter()
            .find(|offer| {
                RuntimeWorld::transfer_offer_key(offer)
                    == Some(TransferOfferKey {
                        item_id: STORY_BUTTON_ITEM_ID,
                        target_actor_id: 5001,
                        target_item_id: WATCH_BELL_ITEM_ID,
                    })
            })
            .expect("the direct target has an exact trade offer")
            .clone();
        let direct_trade = runtime
            .plan_transfer_offer_action(5000, &direct_trade_offer)
            .expect("the exact trade plans");
        assert_eq!(direct_trade.kind, CW_ACTION_TRADE_ITEM);
        assert_eq!(direct_trade.item_id, STORY_BUTTON_ITEM_ID);
        assert_eq!(direct_trade.target_actor_id, 5001);
        assert_eq!(direct_trade.target_item_id, WATCH_BELL_ITEM_ID);

        let actor = runtime.actor_by_id(5000).expect("offer maker exists");
        assert!(
            runtime
                .fresh_resident_autonomy_action(actor, direct_gift)
                .is_none(),
            "an inferred controller cannot bypass a direct target's consent click"
        );
        assert!(
            runtime
                .fresh_resident_autonomy_action(actor, direct_trade)
                .is_none(),
            "an inferred controller cannot bypass a direct target's trade decision"
        );

        let gift_trace = runtime.resident_decision_trace(&ResidentAutonomyCandidate {
            actor_id: 5000,
            rank: 20,
            score: 0,
            record: JournalRecord::new(direct_gift, 98_100)
                .into_actor_consequence(runtime.world.tick, None),
        });
        assert_eq!(
            gift_trace.choice.offer_id.as_deref(),
            Some(direct_gift_offer.offer_id.as_str())
        );
        assert!(gift_trace.candidates.iter().any(|candidate| {
            candidate.selected
                && candidate.provider_id == format!("item:{STORY_BUTTON_ITEM_ID}")
                && candidate
                    .target
                    .as_ref()
                    .is_some_and(|target| target.id == Some(5001))
        }));

        let mut forged_offer = direct_trade_offer.clone();
        forged_offer.provider.id = format!("item:{DEWBRIGHT_BUTTON_ITEM_ID}");
        assert!(runtime
            .plan_transfer_offer_action(5000, &forged_offer)
            .is_err());

        let inferred_gift_offer = inference_offers
            .iter()
            .find(|offer| {
                RuntimeWorld::transfer_offer_key(offer)
                    == Some(TransferOfferKey {
                        item_id: STORY_BUTTON_ITEM_ID,
                        target_actor_id: RATI_ACTOR_ID,
                        target_item_id: 0,
                    })
            })
            .expect("the inference target has an exact gift offer")
            .clone();
        let inferred_gift = runtime
            .plan_transfer_offer_action(5000, &inferred_gift_offer)
            .expect("the exact inference gift plans");
        let inferred_gift = runtime
            .fresh_resident_autonomy_action(actor, inferred_gift)
            .expect("inference accepts the same exact non-player transfer");
        assert_eq!(
            runtime
                .apply_journal_record(&JournalRecord::new(inferred_gift, 98_101))
                .0,
            CW_OK
        );
        let next_offers = runtime.legal_action_candidates(Some(5000), &access).1;
        assert!(
            next_offers
                .iter()
                .all(|offer| offer.offer_id != inferred_gift_offer.offer_id),
            "the transferred card's dependent offer expires at the next revision"
        );
        assert!(
            next_offers.iter().all(|offer| {
                offer
                    .composition_trace
                    .source_card_instances
                    .iter()
                    .all(|source| source.instance_id != STORY_BUTTON_ITEM_ID)
            }),
            "the transferred card no longer contributes to the former holder's offers"
        );
        assert!(runtime
            .plan_transfer_offer_action(5000, &inferred_gift_offer)
            .is_err());
    }
}
