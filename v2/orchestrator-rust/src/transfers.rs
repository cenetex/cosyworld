use super::*;

impl RuntimeWorld {
    pub(super) fn item_policy_is_configured(item: CwItem) -> bool {
        item.policy_flags & CW_ITEM_POLICY_CONFIGURED != 0
    }

    pub(super) fn item_is_transferable(item: CwItem) -> bool {
        !Self::item_policy_is_configured(item)
            || item.policy_flags & CW_ITEM_POLICY_TRANSFERABLE != 0
    }

    pub(super) fn item_is_theft_eligible(item: CwItem) -> bool {
        Self::item_is_directly_held(item)
            && matches!(
                item.zone,
                CW_CARD_ZONE_CARRIED
                    | CW_CARD_ZONE_EQUIPPED
                    | CW_CARD_ZONE_WORLD
                    | CW_CARD_ZONE_HIDDEN
            )
            && (!Self::item_policy_is_configured(item)
                || item.policy_flags & CW_ITEM_POLICY_THEFT_WHEN_CARRIED != 0)
    }

    pub(super) fn item_is_directly_held(item: CwItem) -> bool {
        item.holder_actor_id != 0
            && item.location_id == 0
            && item.container_item_id == 0
            && !matches!(
                item.zone,
                CW_CARD_ZONE_CONTAINED | CW_CARD_ZONE_ESCROW | CW_CARD_ZONE_INSTALLED
            )
    }

    pub(super) fn item_has_contents(&self, item_id: u64) -> bool {
        self.world.items[..self.world.item_count]
            .iter()
            .any(|item| item.container_item_id == item_id)
    }

    pub(super) fn item_can_leave_actor(&self, actor_id: u64, item: CwItem) -> bool {
        item.holder_actor_id == actor_id
            && Self::item_is_directly_held(item)
            && Self::item_is_transferable(item)
            && !self.item_has_contents(item.id)
    }
}

pub(super) fn private_actor_event(
    type_name: &str,
    actor_id: u64,
    target_actor_id: Option<u64>,
    content: String,
) -> EventView {
    EventView {
        type_name: type_name.to_string(),
        success: true,
        actor_id: Some(actor_id),
        target_actor_id,
        content: Some(content),
        ..EventView::default()
    }
}

pub(super) fn transfer_offer_created_response(
    runtime: &RuntimeWorld,
    offer: &TransferOfferState,
    actor_id: u64,
) -> ActionResponse {
    let target_name = runtime
        .actor_name(offer.offered_to_actor_id)
        .unwrap_or_else(|| format!("Avatar {}", offer.offered_to_actor_id));
    let item_name = runtime
        .item_name(offer.offered_item_id)
        .unwrap_or_else(|| format!("Item {}", offer.offered_item_id));
    let content = match offer.kind {
        TransferOfferKind::Gift => format!(
            "Gift offer {} sent privately to {target_name} for {item_name}.",
            offer.id
        ),
        TransferOfferKind::Trade => {
            let requested_name = offer
                .requested_item_id
                .and_then(|id| runtime.item_name(id))
                .unwrap_or_else(|| "their item".to_string());
            format!(
                "Trade offer {} sent privately to {target_name}: {item_name} for {requested_name}.",
                offer.id
            )
        }
    };
    ActionResponse {
        ok: true,
        status: CW_OK,
        events: vec![private_actor_event(
            "transfer.offer_created",
            actor_id,
            Some(offer.offered_to_actor_id),
            content,
        )],
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TransferOfferKey {
    item_id: u64,
    target_actor_id: u64,
    target_item_id: u64,
}

impl RuntimeWorld {
    pub(super) fn transfer_offer_status(&self, offer: &TransferOfferState) -> TransferOfferStatus {
        if offer.status != TransferOfferStatus::Pending {
            return offer.status;
        }
        if self.world.tick >= offer.expires_tick {
            return TransferOfferStatus::Expired;
        }
        let participants_separated = self
            .actor_by_id(offer.offered_by_actor_id)
            .zip(self.actor_by_id(offer.offered_to_actor_id))
            .is_some_and(|(giver, recipient)| giver.location_id != recipient.location_id);
        if participants_separated {
            TransferOfferStatus::Invalidated
        } else {
            TransferOfferStatus::Pending
        }
    }

    pub(super) fn expire_transfer_offers(&mut self) {
        let tick = self.world.tick;
        let actor_locations = self.world.actors[..self.world.actor_count]
            .iter()
            .map(|actor| (actor.id, actor.location_id))
            .collect::<BTreeMap<_, _>>();
        for offer in self.transfer_offers.values_mut() {
            if offer.status != TransferOfferStatus::Pending {
                continue;
            }
            if tick >= offer.expires_tick {
                offer.status = TransferOfferStatus::Expired;
                continue;
            }
            let participants_separated = actor_locations
                .get(&offer.offered_by_actor_id)
                .zip(actor_locations.get(&offer.offered_to_actor_id))
                .is_some_and(|(giver_location, recipient_location)| {
                    giver_location != recipient_location
                });
            if participants_separated {
                offer.status = TransferOfferStatus::Invalidated;
            }
        }
    }

    pub(super) fn matching_pending_transfer_offer(
        &self,
        kind: TransferOfferKind,
        offered_by_actor_id: u64,
        offered_to_actor_id: u64,
        offered_item_id: u64,
        requested_item_id: Option<u64>,
    ) -> Option<&TransferOfferState> {
        self.transfer_offers.values().find(|offer| {
            self.transfer_offer_status(offer) == TransferOfferStatus::Pending
                && offer.kind == kind
                && offer.offered_by_actor_id == offered_by_actor_id
                && offer.offered_to_actor_id == offered_to_actor_id
                && offer.offered_item_id == offered_item_id
                && offer.requested_item_id == requested_item_id
        })
    }

    pub(super) fn new_transfer_offer(
        &self,
        kind: TransferOfferKind,
        offered_by_actor_id: u64,
        offered_to_actor_id: u64,
        offered_item_id: u64,
        requested_item_id: Option<u64>,
    ) -> TransferOfferState {
        let kind_label = match kind {
            TransferOfferKind::Gift => "gift",
            TransferOfferKind::Trade => "trade",
        };
        TransferOfferState {
            id: format!(
                "{kind_label}-{}-{}-{}-{}-{}-{}",
                offered_by_actor_id,
                offered_to_actor_id,
                offered_item_id,
                requested_item_id.unwrap_or_default(),
                self.world.next_event_seq,
                self.next_seed
            ),
            kind,
            offered_by_actor_id,
            offered_to_actor_id,
            offered_item_id,
            requested_item_id,
            created_tick: self.world.tick,
            expires_tick: self.world.tick.saturating_add(TRANSFER_OFFER_TTL_TICKS),
            status: TransferOfferStatus::Pending,
            resolved_by_actor_id: None,
        }
    }

    fn authored_player_gift_requests(&self, actor_id: u64) -> Vec<(CwItem, CwActor)> {
        let Some(actor) = self
            .actor_by_id(actor_id)
            .filter(|actor| Self::actor_can_act(*actor))
        else {
            return Vec::new();
        };
        let mut requests = Vec::new();
        for target in self.world.actors[..self.world.actor_count].iter().copied() {
            let Some(relationship) = self.relationship_contract(target.id) else {
                continue;
            };
            let Some(request) = self.resident_request_for_holder(target, actor_id) else {
                continue;
            };
            let Some(item) = self.item_by_id(request.item_id) else {
                continue;
            };
            if target.id == actor_id
                || !Self::actor_can_act(target)
                || target.location_id != actor.location_id
                || self.actors_blocked(actor_id, target.id)
                || relationship.active_on_gift_item_id != item.id
                || self.active_bond(actor_id, target.id).is_none()
                || self
                    .actor_gift_is_legal(actor_id, target.id, item.id)
                    .is_err()
            {
                continue;
            }
            requests.push((item, target));
        }
        requests.sort_by_key(|(item, target)| (target.id, item.id));
        requests
    }

    pub(super) fn gift_request_is_valid(
        &self,
        recipient_actor_id: u64,
        offered_by_actor_id: u64,
        item_id: u64,
    ) -> bool {
        self.actor_by_id(recipient_actor_id)
            .zip(self.actor_by_id(offered_by_actor_id))
            .zip(self.item_by_id(item_id))
            .is_some_and(|((recipient, holder), item)| {
                recipient.id != holder.id
                    && Self::actor_can_act(recipient)
                    && Self::actor_can_act(holder)
                    && self.actor_control_mode(recipient.id).is_direct_input()
                    && self.actor_control_mode(holder.id).is_direct_input()
                    && recipient.location_id == holder.location_id
                    && self.item_can_leave_actor(holder.id, item)
                    && !self.actors_blocked(recipient.id, holder.id)
                    && self.economy_known_by(recipient.id, holder.id)
                    && self.actor_can_receive_item(recipient, item.id)
            })
    }

    pub(super) fn has_actor_gift(&self, actor_id: u64) -> bool {
        self.actor_give_candidate(actor_id).is_some()
    }

    pub(super) fn actor_give_candidate(&self, actor_id: u64) -> Option<(CwItem, CwActor)> {
        let actor = self.actor_by_id(actor_id)?;
        Self::actor_can_act(actor).then_some(())?;
        if let Some(request) = self
            .authored_player_gift_requests(actor_id)
            .into_iter()
            .next()
        {
            return Some(request);
        }
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
            .filter(|actor| Self::actor_can_act(*actor))
        else {
            return Vec::new();
        };
        let preferred = self
            .actor_give_candidate(actor_id)
            .map(|(item, target)| (item.id, target.id));
        let exact_requests = self.authored_player_gift_requests(actor.id);
        let mut choices = exact_requests.clone();
        for item in self.actor_held_items(actor.id) {
            for target in self.active_chat_targets(actor.id) {
                if !self.economy_known_by(actor.id, target.id)
                    && exact_requests
                        .iter()
                        .any(|(_, recipient)| recipient.id == target.id)
                {
                    continue;
                }
                if exact_requests.iter().any(|(requested, recipient)| {
                    requested.id == item.id && recipient.id == target.id
                }) {
                    continue;
                }
                if self
                    .actor_gift_is_legal(actor.id, target.id, item.id)
                    .is_ok()
                {
                    choices.push((item, target));
                }
            }
        }
        choices.retain(|(item, target)| {
            self.matching_pending_transfer_offer(
                TransferOfferKind::Gift,
                actor.id,
                target.id,
                item.id,
                None,
            )
            .is_none()
        });
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

    pub(super) fn pending_transfer_acceptance_offers(
        &self,
        actor_id: u64,
    ) -> Vec<RankedActionOffer> {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return Vec::new();
        };
        let zone = self
            .room_sheets
            .get(&actor.location_id)
            .map(|sheet| room_sheet_zone(sheet).to_string())
            .unwrap_or_else(|| default_zone_for_scope("room", actor.location_id).to_string());
        let mut pending = self
            .transfer_offers
            .values()
            .filter(|offer| {
                offer.kind == TransferOfferKind::Gift
                    && offer.offered_to_actor_id == actor_id
                    && self.transfer_offer_status(offer) == TransferOfferStatus::Pending
            })
            .cloned()
            .collect::<Vec<_>>();
        pending.sort_by(|left, right| {
            left.created_tick
                .cmp(&right.created_tick)
                .then_with(|| left.id.cmp(&right.id))
        });
        pending
            .into_iter()
            .map(|pending| {
                let giver_name = self
                    .actor_name(pending.offered_by_actor_id)
                    .unwrap_or_else(|| format!("Avatar {}", pending.offered_by_actor_id));
                let item_name = self
                    .item_name(pending.offered_item_id)
                    .unwrap_or_else(|| format!("Item {}", pending.offered_item_id));
                let label = format!("Accept {item_name} from {giver_name}");
                let target = ActionTargetView {
                    kind: "actor".to_string(),
                    id: Some(pending.offered_by_actor_id),
                    label: Some(giver_name.clone()),
                };
                let mut offer = self.ranked_offer_from_parts(
                    ACCEPT_TRANSFER_OFFER_KIND,
                    &label,
                    &format!("accept {}", pending.id),
                    action_offer_rank(ACCEPT_TRANSFER_OFFER_KIND),
                    false,
                    None,
                    Some(target),
                    None,
                    None,
                    Some(format!("{item_name} passes from {giver_name} to you")),
                    Some(pending.id.clone()),
                    "a directly controlled avatar offered this item in the shared room",
                );
                offer.id = format!("accept_transfer:{}", pending.id);
                offer.offer_id = format!(
                    "{}:{}:{}",
                    offer.rules_profile, offer.state_revision, offer.id
                );
                offer.verb = "Accept".to_string();
                offer.label = label.clone();
                offer.accessible_label = label;
                offer.zone = zone.clone();
                offer.source = "pending_transfer_offer".to_string();
                offer.provider = action_provider(
                    "pending_gift",
                    format!("transfer:{}", pending.id),
                    item_name,
                    format!("{giver_name} is waiting for your answer in this room"),
                    0,
                );
                if let Some(source) = self.item_source_collectible(pending.offered_item_id) {
                    offer.source_collectible = Some(source.clone());
                    offer
                        .composition_trace
                        .source_card_instances
                        .insert(0, source);
                }
                offer
            })
            .collect()
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
    fn disclosed_item_actions_never_offer_player_consent_for_inference_holders() {
        let mut runtime = RuntimeWorld::seeded();
        create_transfer_test_actor(&mut runtime, 5000, "Request Viewer");
        create_transfer_test_actor(&mut runtime, 5001, "Direct Holder");
        for item in &mut runtime.world.items[..runtime.world.item_count] {
            let holder_actor_id = match item.id {
                STORY_BUTTON_ITEM_ID => Some(5001),
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
        let state = runtime.state_response(Some(5000), &AccessContext::default());
        let actions_for = |actor_id, item_id| {
            state
                .actors
                .iter()
                .find(|actor| actor.id == actor_id)
                .and_then(|actor| actor.resident_economy.as_ref())
                .and_then(|economy| {
                    economy
                        .held_items
                        .iter()
                        .find(|item| item.item_id == item_id)
                })
                .map(|item| item.available_actions.clone())
                .unwrap_or_default()
        };
        assert!(actions_for(5001, STORY_BUTTON_ITEM_ID)
            .iter()
            .any(|action| action == "request"));
        assert!(actions_for(RATI_ACTOR_ID, DEWBRIGHT_BUTTON_ITEM_ID)
            .iter()
            .all(|action| action != "request"));
    }

    #[test]
    fn pending_gift_moves_to_the_recipient_hand_until_either_avatar_leaves() {
        for mover_id in [5000, 5001] {
            let mut runtime = RuntimeWorld::seeded();
            create_transfer_test_actor(&mut runtime, 5000, "Room-Bound Giver");
            create_transfer_test_actor(&mut runtime, 5001, "Room-Bound Receiver");
            runtime.actor_autonomy.entry(5000).or_default().control_mode =
                ActorControlMode::DirectInput;
            runtime.actor_autonomy.entry(5001).or_default().control_mode =
                ActorControlMode::DirectInput;
            let item = runtime.world.items[..runtime.world.item_count]
                .iter_mut()
                .find(|item| item.id == STORY_BUTTON_ITEM_ID)
                .expect("gift item exists");
            item.location_id = 0;
            item.holder_actor_id = 5000;
            runtime.record_economy_disclosure(5000, 5001);

            let pending = runtime.new_transfer_offer(
                TransferOfferKind::Gift,
                5000,
                5001,
                STORY_BUTTON_ITEM_ID,
                None,
            );
            let offer_id = pending.id.clone();
            runtime.transfer_offers.insert(offer_id.clone(), pending);

            let giver_view = runtime.state_response(Some(5000), &AccessContext::default());
            assert!(!giver_view.action_offers.iter().any(|offer| {
                offer.kind == "give_item"
                    && offer.target.as_ref().and_then(|target| target.id) == Some(5001)
                    && offer.provider.id == format!("item:{STORY_BUTTON_ITEM_ID}")
            }));
            let receiver_view = runtime.state_response(Some(5001), &AccessContext::default());
            assert_eq!(
                receiver_view
                    .action_hand
                    .entries
                    .first()
                    .map(|entry| entry.kind.as_str()),
                Some(ACCEPT_TRANSFER_OFFER_KIND)
            );
            assert!(receiver_view.action_offers.iter().any(|offer| {
                offer.kind == ACCEPT_TRANSFER_OFFER_KIND
                    && offer.claim_key.as_deref() == Some(offer_id.as_str())
            }));

            let (status, _) = runtime.apply_journal_record(&JournalRecord::new(
                CwAction {
                    kind: CW_ACTION_MOVE,
                    actor_id: mover_id,
                    destination_location_id: RAIN_SOFT_GARDEN_LOCATION_ID,
                    ..CwAction::default()
                },
                98_700 + mover_id,
            ));
            assert_eq!(status, CW_OK);
            assert_eq!(
                runtime.transfer_offers[&offer_id].status,
                TransferOfferStatus::Invalidated,
                "moving actor {mover_id} away cancels the room-bound gift"
            );
            let receiver_view = runtime.state_response(Some(5001), &AccessContext::default());
            assert!(receiver_view.safety.incoming_offers.is_empty());
            assert!(receiver_view
                .action_hand
                .entries
                .iter()
                .all(|entry| entry.kind != ACCEPT_TRANSFER_OFFER_KIND));
        }
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
        assert!(
            action_hand
                .entries
                .iter()
                .all(|entry| entry.offer_ids.iter().all(|offer_id| {
                    direct_offers
                        .iter()
                        .any(|offer| offer.offer_id == *offer_id)
                })),
            "every transfer noun must retain all of its exact offer bindings"
        );
        assert_eq!(
            action_hand
                .entries
                .iter()
                .map(|entry| &entry.card_id)
                .collect::<BTreeSet<_>>()
                .len(),
            action_hand.entries.len(),
            "the Story Hand cannot duplicate noun cards"
        );

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

        runtime
            .draw_until_test_offer(5000, &access, |offer| {
                RuntimeWorld::transfer_offer_key(offer)
                    == Some(TransferOfferKey {
                        item_id: STORY_BUTTON_ITEM_ID,
                        target_actor_id: 5001,
                        target_item_id: 0,
                    })
            })
            .expect("the exact player Gift card is dealt within a bounded rotation");
        let direct_gift_offer = runtime
            .legal_action_candidates(Some(5000), &access)
            .1
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

        runtime
            .draw_until_test_offer(5000, &access, |offer| {
                RuntimeWorld::transfer_offer_key(offer)
                    == Some(TransferOfferKey {
                        item_id: STORY_BUTTON_ITEM_ID,
                        target_actor_id: 5001,
                        target_item_id: WATCH_BELL_ITEM_ID,
                    })
            })
            .expect("the exact player Trade card is dealt within a bounded rotation");
        let direct_trade_offer = runtime
            .legal_action_candidates(Some(5000), &access)
            .1
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

        runtime
            .draw_until_test_offer(5000, &access, |offer| {
                RuntimeWorld::transfer_offer_key(offer)
                    == Some(TransferOfferKey {
                        item_id: STORY_BUTTON_ITEM_ID,
                        target_actor_id: 5001,
                        target_item_id: 0,
                    })
            })
            .expect("the player Gift card remains reachable for its decision trace");
        let gift_trace_offer = runtime
            .legal_action_candidates(Some(5000), &access)
            .1
            .into_iter()
            .find(|offer| {
                RuntimeWorld::transfer_offer_key(offer)
                    == Some(TransferOfferKey {
                        item_id: STORY_BUTTON_ITEM_ID,
                        target_actor_id: 5001,
                        target_item_id: 0,
                    })
            })
            .expect("the dealt Gift card remains exact in its trace");
        let gift_trace = runtime.resident_decision_trace(&ResidentAutonomyCandidate {
            actor_id: 5000,
            rank: 20,
            score: 0,
            record: JournalRecord::new(direct_gift, 98_100)
                .into_actor_consequence(runtime.world.tick, None),
        });
        assert_eq!(
            gift_trace.choice.offer_id.as_deref(),
            Some(gift_trace_offer.offer_id.as_str())
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

        runtime
            .draw_until_test_offer(5000, &access, |offer| {
                RuntimeWorld::transfer_offer_key(offer)
                    == Some(TransferOfferKey {
                        item_id: STORY_BUTTON_ITEM_ID,
                        target_actor_id: RATI_ACTOR_ID,
                        target_item_id: 0,
                    })
            })
            .expect("the exact resident Gift card is dealt within a bounded rotation");
        let inferred_gift_offer = runtime
            .legal_action_candidates(Some(5000), &access)
            .1
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
