use super::*;
use sha2::{Digest, Sha256};

pub(super) const RESCUE_DRAUGHT_NAME: &str = "Rescue Draught";
const RESCUE_DRAUGHT_CARD_ID: &str = "cosyworld:rescue-draught";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct AvatarRescueState {
    pub(super) id: String,
    pub(super) account_key: String,
    pub(super) downed_actor_id: u64,
    pub(super) rescuer_actor_id: u64,
    pub(super) draught_item_id: u64,
    pub(super) status: String,
    pub(super) started_tick: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) resolved_tick: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) inhabited_actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) released_actor_id: Option<u64>,
}

#[derive(Clone, Debug)]
pub(super) enum AvatarRescueCreationContext {
    Begin {
        downed_actor_id: u64,
        account_key: String,
    },
    Cascade {
        previous: AvatarRescueState,
        downed_actor_id: u64,
        account_key: String,
    },
}

pub(super) fn avatar_rescue_account_key(wallet_address: &str) -> String {
    let digest = Sha256::digest(wallet_address.trim().as_bytes());
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut encoded, "{byte:02x}");
    }
    encoded
}

fn avatar_rescue_begin_claim_key(rescue_id: &str) -> String {
    format!("avatar_rescue:begin:{rescue_id}")
}

fn avatar_rescue_resolve_claim_key(rescue_id: &str) -> String {
    format!("avatar_rescue:resolve:{rescue_id}")
}

fn avatar_rescue_cascade_claim_key(previous_rescue_id: &str, rescue_id: &str) -> String {
    format!("avatar_rescue:cascade:{previous_rescue_id}:{rescue_id}")
}

pub(super) fn stage_avatar_session_handoff(
    state: &AppState,
    from_actor_id: u64,
    to_actor_id: u64,
) -> io::Result<()> {
    if from_actor_id == to_actor_id {
        return Ok(());
    }
    let Some(path) = state.event_store_path.as_deref() else {
        return Ok(());
    };
    stage_avatar_session_handoff_at_path(path, from_actor_id, to_actor_id)
}

pub(super) fn stage_avatar_session_handoff_at_path(
    path: &Path,
    from_actor_id: u64,
    to_actor_id: u64,
) -> io::Result<()> {
    if from_actor_id == to_actor_id {
        return Ok(());
    }
    init_event_store(path)?;
    let conn = open_event_store(path)?;
    let now_ms = now_millis() as i64;
    conn.execute(
        "INSERT INTO avatar_session_handoffs
            (from_actor_id, to_actor_id, reason, created_at_ms, updated_at_ms,
             consumed_count, last_consumed_at_ms, retired_at_ms)
         VALUES (?1, ?2, 'linked_account_rescue', ?3, ?3, 0, NULL, NULL)
         ON CONFLICT(from_actor_id) DO UPDATE SET
            to_actor_id = excluded.to_actor_id,
            reason = excluded.reason,
            updated_at_ms = excluded.updated_at_ms,
            retired_at_ms = NULL",
        params![from_actor_id as i64, to_actor_id as i64, now_ms],
    )
    .map_err(sqlite_error)?;
    Ok(())
}

pub(super) fn reconcile_avatar_rescue_session_handoffs(
    runtime: &RuntimeWorld,
    path: &Path,
) -> io::Result<()> {
    for rescue in runtime.avatar_rescues.values().filter(|rescue| {
        rescue.status == "resolved"
            && rescue
                .inhabited_actor_id
                .is_some_and(|actor_id| actor_id != rescue.rescuer_actor_id)
    }) {
        stage_avatar_session_handoff_at_path(
            path,
            rescue.rescuer_actor_id,
            rescue.inhabited_actor_id.expect("filtered inhabited actor"),
        )?;
    }
    Ok(())
}

pub(super) fn reconcile_avatar_rescue_wallet_links(
    runtime: &RuntimeWorld,
    links: &mut BTreeMap<String, u64>,
) {
    for (wallet, actor_id) in links.iter_mut() {
        let account_key = avatar_rescue_account_key(wallet);
        let latest = runtime
            .avatar_rescues
            .values()
            .filter(|rescue| rescue.account_key == account_key)
            .max_by(|left, right| {
                left.started_tick
                    .cmp(&right.started_tick)
                    .then_with(|| left.id.cmp(&right.id))
            });
        let Some(rescue) = latest else {
            continue;
        };
        let reconciled = if rescue.status == "resolved" {
            rescue.inhabited_actor_id
        } else if rescue.status == "active"
            && (*actor_id == rescue.downed_actor_id || *actor_id == rescue.rescuer_actor_id)
        {
            Some(rescue.rescuer_actor_id)
        } else {
            None
        };
        if let Some(reconciled) = reconciled {
            *actor_id = reconciled;
        }
    }
}

impl RuntimeWorld {
    pub(super) fn avatar_rescue_record_already_applied(&self, record: &JournalRecord) -> bool {
        let mut found_rescue_mutation = false;
        for mutation in &record.projection_mutations {
            let applied = match mutation {
                ProjectionMutation::BeginAvatarRescue { rescue } => {
                    found_rescue_mutation = true;
                    self.rpg_claims
                        .contains(&avatar_rescue_begin_claim_key(&rescue.id))
                        || self
                            .avatar_rescues
                            .get(&rescue.id)
                            .is_some_and(|stored| stored == rescue)
                }
                ProjectionMutation::ResolveAvatarRescue {
                    rescue_id,
                    inhabited_actor_id,
                    released_actor_id,
                } => {
                    found_rescue_mutation = true;
                    self.rpg_claims
                        .contains(&avatar_rescue_resolve_claim_key(rescue_id))
                        || self.avatar_rescues.get(rescue_id).is_some_and(|rescue| {
                            rescue.status == "resolved"
                                && rescue.inhabited_actor_id == Some(*inhabited_actor_id)
                                && rescue.released_actor_id == Some(*released_actor_id)
                        })
                }
                ProjectionMutation::CascadeAvatarRescue {
                    previous_rescue_id,
                    rescue,
                } => {
                    found_rescue_mutation = true;
                    self.rpg_claims.contains(&avatar_rescue_cascade_claim_key(
                        previous_rescue_id,
                        &rescue.id,
                    )) || (self
                        .avatar_rescues
                        .get(previous_rescue_id)
                        .is_some_and(|previous| previous.status == "superseded")
                        && self
                            .avatar_rescues
                            .get(&rescue.id)
                            .is_some_and(|stored| stored == rescue))
                }
                _ => continue,
            };
            if !applied {
                return false;
            }
        }
        found_rescue_mutation
    }

    pub(super) fn avatar_rescue_creation_context(
        &self,
        linked_actor_id: u64,
        account_key: String,
    ) -> Option<AvatarRescueCreationContext> {
        let linked = self.actor_by_id(linked_actor_id)?;
        if linked.status != CW_ACTOR_KNOCKED_OUT
            || !self.actor_control_mode(linked_actor_id).is_direct_input()
        {
            return None;
        }
        if let Some(previous) = self.avatar_rescues.values().find(|rescue| {
            rescue.status == "active"
                && rescue.account_key == account_key
                && rescue.rescuer_actor_id == linked_actor_id
        }) {
            return Some(AvatarRescueCreationContext::Cascade {
                previous: previous.clone(),
                downed_actor_id: linked_actor_id,
                account_key,
            });
        }
        if self
            .avatar_rescues
            .values()
            .any(|rescue| rescue.status == "active" && rescue.account_key == account_key)
        {
            return None;
        }
        Some(AvatarRescueCreationContext::Begin {
            downed_actor_id: linked_actor_id,
            account_key,
        })
    }

    pub(super) fn new_avatar_rescue_state(
        &self,
        account_key: String,
        downed_actor_id: u64,
        rescuer_actor_id: u64,
    ) -> AvatarRescueState {
        let id = format!("avatar-rescue:{downed_actor_id}:{rescuer_actor_id}");
        let receipt_id = format!("{id}:birth-draught");
        AvatarRescueState {
            id,
            account_key,
            downed_actor_id,
            rescuer_actor_id,
            draught_item_id: materialized_item_id(&receipt_id),
            status: "active".to_string(),
            started_tick: self.world.tick,
            resolved_tick: None,
            inhabited_actor_id: None,
            released_actor_id: None,
        }
    }

    pub(super) fn rescue_draught_materialization(
        &self,
        rescue: &AvatarRescueState,
    ) -> ProjectionMutation {
        let receipt_id = format!("{}:birth-draught", rescue.id);
        ProjectionMutation::MaterializeItem {
            receipt: MaterializationReceiptState {
                id: receipt_id,
                actor_id: rescue.rescuer_actor_id,
                card_id: RESCUE_DRAUGHT_CARD_ID.to_string(),
                item_id: rescue.draught_item_id,
                status: "materialized".to_string(),
                source_wallet: None,
                source_event_seq: self.world.next_event_seq,
            },
            item: CwItem {
                id: rescue.draught_item_id,
                kind: CW_ITEM_POTION,
                charges: 1,
                weight_tenths: 1,
                size_class: CW_ITEM_SIZE_TINY,
                role: CW_ITEM_ROLE_CONSUMABLE,
                zone: CW_CARD_ZONE_CARRIED,
                max_charges: 1,
                holder_actor_id: rescue.rescuer_actor_id,
                held_since_tick: self.world.tick,
                ..CwItem::default()
            },
            meta: ItemMeta {
                name: RESCUE_DRAUGHT_NAME.to_string(),
                description: "A single bright draught, granted because someone linked to this account is waiting to be rescued.".to_string(),
                skill_id: None,
                skill_bonus: 0,
                mechanics: None,
            },
            reason: "linked_account_rescue_birth_grant".to_string(),
        }
    }

    pub(super) fn active_avatar_rescue_for_downed(
        &self,
        actor_id: u64,
    ) -> Option<&AvatarRescueState> {
        self.avatar_rescues
            .values()
            .find(|rescue| rescue.status == "active" && rescue.downed_actor_id == actor_id)
    }

    pub(super) fn active_avatar_rescue_for_delivery(
        &self,
        rescuer_actor_id: u64,
        draught_item_id: u64,
        downed_actor_id: u64,
    ) -> Option<&AvatarRescueState> {
        self.avatar_rescues.values().find(|rescue| {
            rescue.status == "active"
                && rescue.rescuer_actor_id == rescuer_actor_id
                && rescue.downed_actor_id == downed_actor_id
                && rescue.draught_item_id == draught_item_id
        })
    }

    pub(super) fn plan_avatar_rescue_completion(
        &self,
        rescuer_actor_id: u64,
        draught_item_id: u64,
        downed_actor_id: u64,
        inhabited_actor_id: u64,
    ) -> Result<(CwAction, ProjectionMutation), String> {
        let rescue = self
            .active_avatar_rescue_for_delivery(rescuer_actor_id, draught_item_id, downed_actor_id)
            .ok_or_else(|| "That rescue is no longer waiting for this draught.".to_string())?;
        if !matches!(
            inhabited_actor_id,
            id if id == rescue.rescuer_actor_id || id == rescue.downed_actor_id
        ) {
            return Err("Choose which of the two rescued avatars you will inhabit.".to_string());
        }
        let certified_use =
            self.plan_use_item_choice_action(rescuer_actor_id, draught_item_id, downed_actor_id)?;
        let released_actor_id = if inhabited_actor_id == rescue.rescuer_actor_id {
            rescue.downed_actor_id
        } else {
            rescue.rescuer_actor_id
        };
        Ok((
            CwAction {
                kind: CW_ACTION_COMPLETE_AVATAR_RESCUE,
                actor_id: certified_use.actor_id,
                target_actor_id: certified_use.target_actor_id,
                item_id: certified_use.item_id,
                content_id: inhabited_actor_id,
                ..CwAction::default()
            },
            ProjectionMutation::ResolveAvatarRescue {
                rescue_id: rescue.id.clone(),
                inhabited_actor_id,
                released_actor_id,
            },
        ))
    }

    pub(super) fn avatar_rescue_record_preconditions_hold(&self, record: &JournalRecord) -> bool {
        for mutation in &record.projection_mutations {
            match mutation {
                ProjectionMutation::BeginAvatarRescue { rescue } => {
                    if record.action.kind != CW_ACTION_CREATE_ACTOR
                        || record.action.actor_id != rescue.rescuer_actor_id
                        || self
                            .actor_by_id(rescue.downed_actor_id)
                            .is_none_or(|actor| actor.status != CW_ACTOR_KNOCKED_OUT)
                        || rescue.status != "active"
                    {
                        return false;
                    }
                }
                ProjectionMutation::ResolveAvatarRescue {
                    rescue_id,
                    inhabited_actor_id,
                    released_actor_id,
                } => {
                    let Some(rescue) = self.avatar_rescues.get(rescue_id) else {
                        return false;
                    };
                    if rescue.status != "active"
                        || record.action.kind != CW_ACTION_COMPLETE_AVATAR_RESCUE
                        || record.action.actor_id != rescue.rescuer_actor_id
                        || record.action.target_actor_id != rescue.downed_actor_id
                        || record.action.item_id != rescue.draught_item_id
                        || record.action.content_id != *inhabited_actor_id
                        || !matches!(
                            (*inhabited_actor_id, *released_actor_id),
                            (inhabited, released)
                                if (inhabited == rescue.rescuer_actor_id
                                    && released == rescue.downed_actor_id)
                                    || (inhabited == rescue.downed_actor_id
                                        && released == rescue.rescuer_actor_id)
                        )
                    {
                        return false;
                    }
                }
                ProjectionMutation::CascadeAvatarRescue {
                    previous_rescue_id,
                    rescue,
                } => {
                    let Some(previous) = self.avatar_rescues.get(previous_rescue_id) else {
                        return false;
                    };
                    if previous.status != "active"
                        || record.action.kind != CW_ACTION_REPLACE_AVATAR_RESCUER
                        || record.action.actor_id != rescue.rescuer_actor_id
                        || record.action.target_actor_id != previous.downed_actor_id
                        || record.action.content_id != previous.rescuer_actor_id
                        || record.action.item_id != previous.draught_item_id
                        || rescue.downed_actor_id != previous.rescuer_actor_id
                        || rescue.account_key != previous.account_key
                        || self
                            .actor_by_id(previous.downed_actor_id)
                            .is_none_or(|actor| actor.status != CW_ACTOR_KNOCKED_OUT)
                        || self
                            .actor_by_id(previous.rescuer_actor_id)
                            .is_none_or(|actor| actor.status != CW_ACTOR_KNOCKED_OUT)
                    {
                        return false;
                    }
                }
                _ => {}
            }
        }
        true
    }

    pub(super) fn apply_begin_avatar_rescue(
        &mut self,
        rescue: &AvatarRescueState,
    ) -> Vec<EventView> {
        let claim_key = avatar_rescue_begin_claim_key(&rescue.id);
        if self.avatar_rescues.contains_key(&rescue.id) {
            self.rpg_claims.insert(claim_key);
            return Vec::new();
        }
        self.avatar_rescues
            .insert(rescue.id.clone(), rescue.clone());
        self.avatar_rescue_predecessors
            .insert(rescue.rescuer_actor_id, rescue.downed_actor_id);
        self.rpg_claims.insert(claim_key);
        vec![self.append_async_job_event(
            "avatar.rescue_run.started",
            rescue.rescuer_actor_id,
            Some(rescue.downed_actor_id),
            Some("A new traveler entered the world to attempt a rescue.".to_string()),
        )]
    }

    pub(super) fn apply_resolve_avatar_rescue(
        &mut self,
        rescue_id: &str,
        inhabited_actor_id: u64,
        released_actor_id: u64,
    ) -> Vec<EventView> {
        let claim_key = avatar_rescue_resolve_claim_key(rescue_id);
        let Some(rescue) = self.avatar_rescues.get_mut(rescue_id) else {
            return Vec::new();
        };
        if rescue.status != "active" {
            self.rpg_claims.insert(claim_key);
            return Vec::new();
        }
        rescue.status = "resolved".to_string();
        rescue.resolved_tick = Some(self.world.tick);
        rescue.inhabited_actor_id = Some(inhabited_actor_id);
        rescue.released_actor_id = Some(released_actor_id);
        self.rpg_claims.insert(claim_key);

        self.ensure_actor_autonomy();
        if let Some(autonomy) = self.actor_autonomy.get_mut(&released_actor_id) {
            autonomy.control_mode = ActorControlMode::LocalAi;
            autonomy.attention_credits = autonomy.attention_credits.max(1);
            autonomy.pending_intent = None;
        }
        if let Some(autonomy) = self.actor_autonomy.get_mut(&inhabited_actor_id) {
            autonomy.control_mode = ActorControlMode::DirectInput;
            autonomy.attention_credits = 0;
            autonomy.pending_intent = None;
        }
        Vec::new()
    }

    pub(super) fn apply_cascade_avatar_rescue(
        &mut self,
        previous_rescue_id: &str,
        rescue: &AvatarRescueState,
    ) -> Vec<EventView> {
        let claim_key = avatar_rescue_cascade_claim_key(previous_rescue_id, &rescue.id);
        let Some(previous) = self.avatar_rescues.get_mut(previous_rescue_id) else {
            return Vec::new();
        };
        if previous.status != "active" {
            self.rpg_claims.insert(claim_key);
            return Vec::new();
        }
        previous.status = "superseded".to_string();
        previous.resolved_tick = Some(self.world.tick);
        self.avatar_rescues
            .insert(rescue.id.clone(), rescue.clone());
        self.avatar_rescue_predecessors
            .insert(rescue.rescuer_actor_id, rescue.downed_actor_id);
        self.rpg_claims.insert(claim_key);
        vec![self.append_deck_event(
            "avatar.rescue.cascaded",
            rescue.rescuer_actor_id,
            Some(rescue.draught_item_id),
            format!(
                "The oldest fallen avatar died; a new rescuer now carries the draught for {}.",
                self.actor_name(rescue.downed_actor_id)
                    .unwrap_or_else(|| format!("Avatar {}", rescue.downed_actor_id))
            ),
        )]
    }
}
