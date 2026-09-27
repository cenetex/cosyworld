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

/// The companion a stable accompany id names.
pub(crate) fn accompany_companion_id(offer_id: &str) -> Option<u64> {
    offer_id
        .strip_prefix("accompany:")?
        .split(':')
        .nth(1)?
        .parse()
        .ok()
}

impl RuntimeWorld {
    /// Whether `companion_id` would travel with `actor_id` right now. Every
    /// fact is journal-derived, so the same answer holds during replay.
    pub(crate) fn accompany_companion_accepts(&self, actor_id: u64, companion_id: u64) -> bool {
        if actor_id == companion_id {
            return false;
        }
        let (Some(actor), Some(companion)) =
            (self.actor_by_id(actor_id), self.actor_by_id(companion_id))
        else {
            return false;
        };
        let bonded = self
            .bonds
            .get(&bond_id(actor_id, companion_id))
            .is_some_and(|bond| matches!(bond.status.as_str(), "forming" | "active"));
        let in_rescue = self.avatar_rescues.values().any(|rescue| {
            rescue.status != "resolved"
                && (rescue.downed_actor_id == companion_id
                    || rescue.rescuer_actor_id == companion_id)
        });
        self.actor_control_mode(actor_id) == ActorControlMode::DirectInput
            && matches!(
                self.actor_control_mode(companion_id),
                ActorControlMode::LocalAi
                    | ActorControlMode::RoamingAi
                    | ActorControlMode::DelegatedAi
            )
            && Self::actor_can_act(companion)
            && companion.location_id == actor.location_id
            && bonded
            && !in_rescue
            && !self.actors_blocked(actor_id, companion_id)
            && self.active_combat_encounter_for_actor(actor_id).is_none()
            && self
                .active_combat_encounter_for_actor(companion_id)
                .is_none()
            && !self.journeys.contains_key(&actor_id)
            && !self.journeys.contains_key(&companion_id)
    }

    fn accompany_companions(&self, actor_id: u64) -> Vec<(u64, String)> {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return Vec::new();
        };
        self.world.actors[..self.world.actor_count]
            .iter()
            .filter(|companion| {
                companion.location_id == actor.location_id
                    && self.actor_visible_in_projection(**companion, Some(actor_id), None)
                    && self.accompany_companion_accepts(actor_id, companion.id)
            })
            .filter_map(|companion| Some((companion.id, self.actor_name(companion.id)?)))
            .collect()
    }

    /// Add one Accompany offer per eligible companion to every adjacent,
    /// two-way, ungated Travel offer.
    pub(crate) fn expand_accompany_action_offers(
        &self,
        actor_id: u64,
        mut offers: Vec<RankedActionOffer>,
    ) -> Vec<RankedActionOffer> {
        let companions = self.accompany_companions(actor_id);
        if companions.is_empty() {
            return offers;
        }
        let mut accompany = Vec::new();
        for offer in offers.iter().filter(|offer| offer.kind == "move") {
            let Some(route) = offer.route.as_ref() else {
                continue;
            };
            if route.threshold.is_some() || route.directionality == RouteDirectionality::OneWay {
                continue;
            }
            let Some(destination) = offer
                .target
                .clone()
                .filter(|target| target.kind == "location")
            else {
                continue;
            };
            let Some(destination_id) = destination.id else {
                continue;
            };
            let destination_name = destination
                .label
                .clone()
                .unwrap_or_else(|| format!("Location {destination_id}"));
            for (companion_id, companion_name) in &companions {
                let mut shared = offer.clone();
                let id = format!("{ACCOMPANY_OFFER_KIND}:{destination_id}:{companion_id}");
                shared.offer_id =
                    format!("{}:{}:{id}", shared.rules_profile, shared.state_revision);
                shared.id = id;
                shared.kind = ACCOMPANY_OFFER_KIND.to_string();
                shared.category = action_offer_category(ACCOMPANY_OFFER_KIND).to_string();
                shared.verb = "Travel with".to_string();
                shared.label = format!("Travel with {companion_name} to {destination_name}");
                shared.accessible_label = format!(
                    "Travel with {companion_name} to {destination_name} via {}",
                    route.route_id
                );
                shared.command = normalize_command_text(&format!(
                    "travel with {companion_name} to {destination_name}"
                ));
                shared.effect = Some(format!("{companion_name} travels there with you"));
                shared.rank = action_offer_rank(ACCOMPANY_OFFER_KIND);
                shared.claim_key = None;
                accompany.push(shared);
            }
        }
        offers.extend(accompany);
        offers
    }

    /// The kernel action for a published Accompany offer, or None when the
    /// companion would no longer come.
    pub(crate) fn plan_accompany_action(
        &self,
        actor_id: u64,
        offer: &RankedActionOffer,
    ) -> Option<CwAction> {
        let companion_id = accompany_companion_id(&offer.id)?;
        let destination_id = offer
            .target
            .as_ref()
            .filter(|target| target.kind == "location")?
            .id?;
        let actor = self.actor_by_id(actor_id)?;
        self.accompany_companion_accepts(actor_id, companion_id)
            .then(|| CwAction {
                kind: CW_ACTION_ACCOMPANY_MOVE,
                actor_id,
                target_actor_id: companion_id,
                location_id: actor.location_id,
                destination_location_id: destination_id,
                ..CwAction::default()
            })
    }

    /// Replay-safe consent gate for an Accompany record: the certified rule is
    /// re-evaluated against the replayed world, which holds the same bonds,
    /// journeys, encounters, and rescues the live commit saw.
    pub(crate) fn accompany_record_preconditions_hold(&self, record: &JournalRecord) -> bool {
        record.action.kind != CW_ACTION_ACCOMPANY_MOVE
            || self
                .accompany_companion_accepts(record.action.actor_id, record.action.target_actor_id)
    }
}

#[cfg(test)]
mod tests;
