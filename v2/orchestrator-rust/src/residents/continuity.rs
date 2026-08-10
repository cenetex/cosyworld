use super::super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResidentContinuityState {
    pub(crate) resident_id: u64,
    pub(crate) stable_identity: String,
    pub(crate) relationship_notes_by_actor: BTreeMap<u64, String>,
    pub(crate) memory_atoms: Vec<ResidentContinuityAtom>,
    #[serde(default)]
    pub(crate) beliefs: Vec<ResidentContinuityNote>,
    #[serde(default)]
    pub(crate) desires: Vec<ResidentContinuityNote>,
    #[serde(default)]
    pub(crate) promises: Vec<ResidentContinuityNote>,
    #[serde(default)]
    pub(crate) refusals: Vec<ResidentContinuityNote>,
    #[serde(default)]
    pub(crate) pending_action: Option<AvatarProposedAction>,
    #[serde(default)]
    pub(crate) pending_planning: Option<ResidentPlanningTrace>,
    #[serde(default)]
    pub(crate) last_planning_disposition: Option<ResidentPlanningDisposition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) recent_voice_shingle_hashes: Vec<u64>,
    pub(crate) open_obligations: Vec<String>,
    pub(crate) current_intent: Option<String>,
    pub(crate) last_observed_event_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResidentContinuityAtom {
    pub(crate) kind: String,
    pub(crate) subject_id: u64,
    pub(crate) text: String,
    pub(crate) confidence: u8,
    pub(crate) salience: u8,
    pub(crate) observed_tick: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResidentContinuityNote {
    pub(crate) text: String,
    pub(crate) source: String,
    pub(crate) source_event_seq: Option<u64>,
    pub(crate) confidence: u8,
}

impl ResidentContinuityState {
    pub(crate) fn empty(resident_id: u64, identity: String) -> Self {
        Self {
            resident_id,
            stable_identity: identity,
            relationship_notes_by_actor: BTreeMap::new(),
            memory_atoms: Vec::new(),
            beliefs: Vec::new(),
            desires: Vec::new(),
            promises: Vec::new(),
            refusals: Vec::new(),
            pending_action: None,
            pending_planning: None,
            last_planning_disposition: None,
            recent_voice_shingle_hashes: Vec::new(),
            open_obligations: Vec::new(),
            current_intent: None,
            last_observed_event_seq: 0,
        }
    }

    fn into_direct_reaction_view(mut self) -> Self {
        self.current_intent = None;
        self.open_obligations.clear();
        self.pending_action = None;
        self.pending_planning = None;
        self.last_planning_disposition = None;
        self.memory_atoms
            .retain(|atom| atom.kind != BELIEF_KIND_ACTOR_WANTS_ITEM);
        self
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct ResidentContinuitySnapshot {
    version: u32,
    #[serde(default)]
    worldpack_bundle_hash: String,
    world_tick: u64,
    latest_event_seq: u64,
    residents: BTreeMap<u64, ResidentContinuityState>,
}

impl ResidentContinuitySnapshot {
    pub(crate) fn from_runtime(runtime: &RuntimeWorld) -> Self {
        let residents = runtime.world.actors[..runtime.world.actor_count]
            .iter()
            .copied()
            .filter(|resident| RuntimeWorld::actor_can_act(*resident))
            .map(|resident| (resident.id, runtime.resident_continuity_for(resident)))
            .collect();
        Self {
            version: 1,
            worldpack_bundle_hash: active_content().manifest.bundle_hash.clone(),
            world_tick: runtime.world.tick,
            latest_event_seq: runtime.world.next_event_seq.saturating_sub(1),
            residents,
        }
    }
}

impl RuntimeWorld {
    pub(crate) fn load_resident_continuity_snapshot(&mut self, path: &Path) -> io::Result<usize> {
        let bytes = fs::read(path)?;
        let snapshot: ResidentContinuitySnapshot = serde_json::from_slice(&bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if snapshot.version != 1 {
            return Err(snapshot_error(
                "unsupported resident continuity snapshot version",
            ));
        }
        let compatibility = persisted_worldpack_replay_compatibility(
            &snapshot.worldpack_bundle_hash,
            "resident continuity",
        )?;
        if compatibility == WorldpackReplayCompatibility::DeclaredMigration {
            warn!(
                "loading resident continuity through declared worldpack migration: {} -> {}",
                snapshot.worldpack_bundle_hash,
                active_content().manifest.bundle_hash
            );
        }
        Ok(self.apply_resident_continuity_snapshot(snapshot))
    }

    fn apply_resident_continuity_snapshot(
        &mut self,
        snapshot: ResidentContinuitySnapshot,
    ) -> usize {
        let mut applied = 0;
        for (resident_id, continuity) in snapshot.residents {
            let Some(resident) = self.actor_by_id(resident_id) else {
                continue;
            };
            if !Self::actor_can_act(resident) {
                continue;
            }
            let current_seq = self
                .resident_continuities
                .get(&resident_id)
                .map(|current| current.last_observed_event_seq)
                .unwrap_or(0);
            if continuity.last_observed_event_seq >= current_seq {
                self.resident_continuities.insert(resident_id, continuity);
                applied += 1;
            }
        }
        self.refresh_all_resident_continuities();
        applied
    }

    #[cfg(test)]
    pub(crate) fn save_resident_continuity_snapshot(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }

        let tmp = path.with_extension("json.tmp");
        let snapshot = ResidentContinuitySnapshot::from_runtime(self);
        let bytes = serde_json::to_vec_pretty(&snapshot)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        fs::write(&tmp, bytes)?;
        fs::rename(tmp, path)?;
        Ok(())
    }

    pub(crate) fn resident_continuity_for(&self, resident: CwActor) -> ResidentContinuityState {
        let identity = self.resident_stable_identity(resident);
        let mut continuity = self
            .resident_continuities
            .get(&resident.id)
            .cloned()
            .unwrap_or_else(|| ResidentContinuityState::empty(resident.id, identity.clone()));
        continuity.stable_identity = identity;
        continuity.relationship_notes_by_actor = self.resident_relationship_notes(resident.id);
        continuity.memory_atoms = self.resident_continuity_atoms(resident.id, 6);
        continuity.recent_voice_shingle_hashes =
            self.resident_recent_voice_shingle_hashes(resident.id);
        let (open_obligations, current_intent) =
            self.resident_open_obligations_and_intent(resident);
        continuity.open_obligations = open_obligations;
        if continuity
            .current_intent
            .as_deref()
            .map(|intent| intent.trim().is_empty())
            .unwrap_or(true)
        {
            continuity.current_intent = current_intent;
        }
        continuity.last_observed_event_seq = continuity
            .last_observed_event_seq
            .max(self.latest_observed_event_seq_for_resident(resident));
        continuity
    }

    pub(crate) fn resident_recent_voice_shingle_hashes(&self, resident_id: u64) -> Vec<u64> {
        const RECENT_VOICE_LINE_LIMIT: usize = 12;
        const RECENT_VOICE_SHINGLE_LIMIT: usize = 192;

        let mut lines = self
            .recent_room_lines
            .values()
            .flat_map(|events| events.iter())
            .filter(|event| {
                event.success
                    && event.type_name == "message.created"
                    && event.actor_id == Some(resident_id)
                    && event.content.is_some()
            })
            .collect::<Vec<_>>();
        lines.sort_by_key(|event| event.seq);

        let mut seen = BTreeSet::new();
        let mut hashes = Vec::new();
        for line in lines.into_iter().rev().take(RECENT_VOICE_LINE_LIMIT) {
            for hash in crate::ai_publication::voice_signature_shingle_hashes(
                line.content.as_deref().unwrap_or_default(),
            ) {
                if seen.insert(hash) {
                    hashes.push(hash);
                    if hashes.len() == RECENT_VOICE_SHINGLE_LIMIT {
                        return hashes;
                    }
                }
            }
        }
        hashes
    }

    pub(crate) fn resident_continuity_for_reaction(
        &self,
        resident: CwActor,
    ) -> ResidentContinuityState {
        let continuity = self.resident_continuity_for(resident);
        if self.actor_uses_inference(resident.id) {
            continuity
        } else {
            continuity.into_direct_reaction_view()
        }
    }

    pub(crate) fn refresh_resident_continuity(&mut self, resident_id: u64) {
        let Some(resident) = self.actor_by_id(resident_id) else {
            self.resident_continuities.remove(&resident_id);
            return;
        };
        if !Self::actor_can_act(resident) {
            self.resident_continuities.remove(&resident_id);
            return;
        }
        let continuity = self.resident_continuity_for(resident);
        self.resident_continuities.insert(resident_id, continuity);
    }

    pub(crate) fn refresh_all_resident_continuities(&mut self) {
        let resident_ids: Vec<u64> = self.world.actors[..self.world.actor_count]
            .iter()
            .copied()
            .filter(|actor| Self::actor_can_act(*actor))
            .map(|actor| actor.id)
            .collect();
        for resident_id in resident_ids {
            self.refresh_resident_continuity(resident_id);
        }
    }

    pub(crate) fn apply_resident_intent_projection(
        &mut self,
        resident_id: u64,
        proposal: &AvatarIntentProposal,
        reason: &str,
    ) {
        self.refresh_resident_continuity(resident_id);
        let source_event_seq = self
            .actor_by_id(resident_id)
            .map(|resident| self.latest_observed_event_seq_for_resident(resident));
        let Some(continuity) = self.resident_continuities.get_mut(&resident_id) else {
            return;
        };
        if let Some(intent) = sanitize_continuity_note_text(proposal.intent.as_deref()) {
            continuity.current_intent = Some(intent);
        } else if let Some(action) = proposal.proposed_action.as_ref() {
            if let Some(intent) = resident_proposed_action_intent(action) {
                continuity.current_intent = Some(intent);
            }
        }
        if let Some(text) = sanitize_continuity_note_text(proposal.belief.as_deref()) {
            push_resident_continuity_note(
                &mut continuity.beliefs,
                text,
                reason,
                source_event_seq,
                180,
            );
        }
        if let Some(text) = sanitize_continuity_note_text(proposal.desire.as_deref()) {
            push_resident_continuity_note(
                &mut continuity.desires,
                text,
                reason,
                source_event_seq,
                190,
            );
        }
        if let Some(text) = sanitize_continuity_note_text(proposal.promise.as_deref()) {
            push_resident_continuity_note(
                &mut continuity.promises,
                text,
                reason,
                source_event_seq,
                210,
            );
        }
        if let Some(text) = sanitize_continuity_note_text(proposal.refusal.as_deref()) {
            push_resident_continuity_note(
                &mut continuity.refusals,
                text,
                reason,
                source_event_seq,
                220,
            );
        }
        if reason != "resident_autonomy_intent" && proposal.proposed_action.is_some() {
            continuity.pending_action = proposal.proposed_action.clone();
        }
        if let Some(source_event_seq) = source_event_seq {
            continuity.last_observed_event_seq =
                continuity.last_observed_event_seq.max(source_event_seq);
        }
    }

    pub(crate) fn resident_stable_identity(&self, resident: CwActor) -> String {
        let name = self
            .actor_name(resident.id)
            .unwrap_or_else(|| format!("Resident {}", resident.id));
        let meta = self.actors.get(&resident.id);
        let title = meta
            .map(|meta| meta.title.as_str())
            .filter(|title| !title.trim().is_empty())
            .unwrap_or("resident");
        let description = meta
            .map(|meta| meta.description.as_str())
            .filter(|description| !description.trim().is_empty())
            .unwrap_or("A resident of CosyWorld.");
        let speech_mode = meta
            .map(|meta| meta.speech_mode.as_str())
            .filter(|mode| !mode.trim().is_empty())
            .unwrap_or("prose");
        format!("{name} / {title} / speech:{speech_mode} / {description}")
    }

    pub(crate) fn resident_relationship_notes(&self, resident_id: u64) -> BTreeMap<u64, String> {
        let mut notes = BTreeMap::new();
        for bond in self.bonds.values() {
            if bond.status == "resolved" {
                continue;
            }
            let other_id = if bond.actor_id == resident_id {
                bond.target_actor_id
            } else if bond.target_actor_id == resident_id {
                bond.actor_id
            } else {
                continue;
            };
            let other_name = self
                .actor_name(other_id)
                .unwrap_or_else(|| format!("Actor {}", other_id));
            let statement = bond.statement.trim();
            let text = if statement.is_empty() {
                format!("{other_name} matters to them.")
            } else {
                format!("Friendship with {other_name}: {statement}")
            };
            notes.insert(other_id, text);
        }
        notes
    }

    pub(crate) fn resident_continuity_atoms(
        &self,
        resident_id: u64,
        limit: usize,
    ) -> Vec<ResidentContinuityAtom> {
        let mut memories: Vec<_> = self
            .beliefs
            .values()
            .filter(|memory| memory.holder_actor_id == resident_id)
            .cloned()
            .collect();
        memories.sort_by_key(|memory| {
            (
                std::cmp::Reverse(memory.salience),
                std::cmp::Reverse(memory.confidence),
                std::cmp::Reverse(memory.observed_tick),
                memory.hops,
                memory.kind.clone(),
                memory.subject_id,
            )
        });
        memories
            .into_iter()
            .filter_map(|memory| {
                self.resident_memory_atom_text(&memory)
                    .map(|text| ResidentContinuityAtom {
                        kind: memory.kind,
                        subject_id: memory.subject_id,
                        text,
                        confidence: memory.confidence,
                        salience: memory.salience,
                        observed_tick: memory.observed_tick,
                    })
            })
            .take(limit)
            .collect()
    }

    fn resident_memory_atom_text(&self, memory: &BeliefState) -> Option<String> {
        let route = if memory.source_actor_id == Some(memory.holder_actor_id) && memory.hops == 0 {
            "saw"
        } else {
            "heard"
        };
        let location_name = self
            .location_name(memory.location_id)
            .unwrap_or_else(|| format!("Location {}", memory.location_id));
        match memory.kind.as_str() {
            BELIEF_KIND_ACTOR_LOCATION => {
                if memory.subject_id == memory.holder_actor_id {
                    return None;
                }
                let actor_name = self
                    .actor_name(memory.subject_id)
                    .unwrap_or_else(|| format!("Actor {}", memory.subject_id));
                Some(format!("{route} {actor_name} near {location_name}"))
            }
            BELIEF_KIND_ITEM_LOCATION => {
                let item_name = self
                    .item_name(memory.subject_id)
                    .unwrap_or_else(|| format!("Item {}", memory.subject_id));
                if let Some(holder_name) = memory
                    .related_actor_id
                    .and_then(|holder_actor_id| self.actor_name(holder_actor_id))
                {
                    Some(format!(
                        "{route} {item_name} with {holder_name} near {location_name}"
                    ))
                } else {
                    Some(format!("{route} {item_name} near {location_name}"))
                }
            }
            BELIEF_KIND_ACTOR_WANTS_ITEM => {
                let target_actor_id = memory.related_actor_id?;
                let target_name = self
                    .actor_name(target_actor_id)
                    .unwrap_or_else(|| format!("Actor {}", target_actor_id));
                let item_name = self
                    .item_name(memory.subject_id)
                    .unwrap_or_else(|| format!("Item {}", memory.subject_id));
                Some(format!(
                    "{route} {target_name} wanted {item_name} near {location_name}"
                ))
            }
            _ => None,
        }
    }

    pub(crate) fn resident_open_obligations_and_intent(
        &self,
        resident: CwActor,
    ) -> (Vec<String>, Option<String>) {
        let Some(economy) = self.resident_economy_view(resident, None) else {
            return (Vec::new(), None);
        };
        let mut obligations = Vec::new();
        if let Some(request) = economy.request.as_ref() {
            let item_name = self
                .item_name(request.item_id)
                .unwrap_or_else(|| format!("Item {}", request.item_id));
            let holder_name = self
                .actor_name(request.holder_actor_id)
                .unwrap_or_else(|| format!("Actor {}", request.holder_actor_id));
            obligations.push(format!(
                "wants {item_name} from {holder_name}: {}",
                request.reason.trim_end_matches('.')
            ));
        }
        if let Some(offer) = economy.trade_offer.as_ref() {
            let offered_name = self
                .item_name(offer.offered_item_id)
                .unwrap_or_else(|| format!("Item {}", offer.offered_item_id));
            let requested_name = self
                .item_name(offer.requested_item_id)
                .unwrap_or_else(|| format!("Item {}", offer.requested_item_id));
            obligations.push(format!(
                "will trade {offered_name} for {requested_name}: {}",
                offer.reason.trim_end_matches('.')
            ));
        }
        let current_intent = if let Some(item_id) = economy.seeking_item_id {
            let item_name = self
                .item_name(item_id)
                .unwrap_or_else(|| format!("Item {}", item_id));
            let place = economy
                .seeking_location_name
                .as_deref()
                .unwrap_or("somewhere nearby");
            Some(format!("seek {item_name} near {place}"))
        } else if !economy.motive.trim().is_empty() {
            Some(economy.motive.trim_end_matches('.').to_string())
        } else {
            None
        };
        (obligations, current_intent)
    }

    pub(crate) fn latest_observed_event_seq_for_resident(&self, resident: CwActor) -> u64 {
        self.event_log
            .iter()
            .filter(|event| {
                event.actor_id == Some(resident.id)
                    || event.target_actor_id == Some(resident.id)
                    || event.location_id == Some(resident.location_id)
                    || event.destination_location_id == Some(resident.location_id)
            })
            .map(|event| event.seq)
            .max()
            .unwrap_or(0)
    }
}

pub(crate) fn sanitize_continuity_note_text(value: Option<&str>) -> Option<String> {
    let text = compact_whitespace(value?.trim().trim_matches('"'));
    if text.is_empty() {
        return None;
    }
    let lowered = format!(" {} ", text.to_lowercase());
    if [" prompt ", " model ", " policy ", " tool ", " system "]
        .iter()
        .any(|needle| lowered.contains(needle))
    {
        return None;
    }
    Some(trim_to_chars(&text, 180))
}

pub(crate) fn push_resident_continuity_note(
    notes: &mut Vec<ResidentContinuityNote>,
    text: String,
    source: &str,
    source_event_seq: Option<u64>,
    confidence: u8,
) {
    if notes
        .iter()
        .any(|note| note.text.eq_ignore_ascii_case(text.as_str()))
    {
        return;
    }
    notes.insert(
        0,
        ResidentContinuityNote {
            text,
            source: source.to_string(),
            source_event_seq,
            confidence,
        },
    );
    notes.truncate(8);
}

pub(crate) fn resident_proposed_action_intent(action: &AvatarProposedAction) -> Option<String> {
    let kind = sanitize_continuity_note_text(Some(&action.kind))?;
    // Entity ids belong to the executable action certificate, not to a resident's
    // interior voice. Keeping them here lets models turn implementation details into
    // dialogue (for example, "item 11453577331"). The typed pending action retains
    // every id needed for validation and execution; continuity only needs the verb.
    let kind = compact_whitespace(&kind.replace('_', " ").replace('-', " "));
    Some(trim_to_chars(&format!("propose {kind}"), 180))
}

pub(crate) fn resident_continuity_path_from_env(
    snapshot_path: Option<&PathBuf>,
) -> Option<PathBuf> {
    match std::env::var("COSYWORLD_V2_RESIDENT_CONTINUITY_PATH") {
        Ok(value) if value.trim().is_empty() => None,
        Ok(value) if value.eq_ignore_ascii_case("off") || value.eq_ignore_ascii_case("none") => {
            None
        }
        Ok(value) => Some(PathBuf::from(value)),
        Err(_) => Some(default_resident_continuity_path(snapshot_path)),
    }
}

fn default_resident_continuity_path(snapshot_path: Option<&PathBuf>) -> PathBuf {
    let Some(snapshot_path) = snapshot_path else {
        return PathBuf::from(".runtime/cosyworld-v2-resident-continuity.json");
    };
    let stem = snapshot_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("cosyworld-v2");
    let base = stem.strip_suffix("-snapshot").unwrap_or(stem);
    snapshot_path.with_file_name(format!("{base}-resident-continuity.json"))
}

impl RuntimeWorld {
    pub(crate) fn resident_pending_proposed_action(&self, actor: CwActor) -> Option<CwAction> {
        let proposal = self
            .resident_continuities
            .get(&actor.id)
            .and_then(|continuity| continuity.pending_action.as_ref())?;
        match proposal.kind.as_str() {
            "pass" => self
                .resident_planner_pass_is_current(actor.id, proposal)
                .then_some(CwAction {
                    kind: CW_ACTION_NONE,
                    actor_id: actor.id,
                    location_id: actor.location_id,
                    ..CwAction::default()
                }),
            "move" => {
                let destination_location_id = proposal.destination_location_id?;
                let next_location_id =
                    self.next_unlocked_step_toward(actor.location_id, destination_location_id)?;
                (next_location_id != actor.location_id).then_some(CwAction {
                    kind: CW_ACTION_MOVE,
                    actor_id: actor.id,
                    destination_location_id: next_location_id,
                    ..CwAction::default()
                })
            }
            "pick_up" => {
                let item_id = proposal.item_id?;
                let item = self.item_by_id(item_id)?;
                if item.location_id == actor.location_id
                    && item.holder_actor_id == 0
                    && !self.actor_inventory_full(actor.id)
                {
                    Some(CwAction {
                        kind: CW_ACTION_PICK_UP_ITEM,
                        actor_id: actor.id,
                        item_id,
                        ..CwAction::default()
                    })
                } else {
                    None
                }
            }
            "drop" => {
                let item_id = proposal.item_id?;
                self.actor_held_items(actor.id)
                    .into_iter()
                    .any(|item| item.id == item_id)
                    .then_some(CwAction {
                        kind: CW_ACTION_DROP_ITEM,
                        actor_id: actor.id,
                        item_id,
                        ..CwAction::default()
                    })
            }
            "give" => {
                let target_actor_id = proposal.target_actor_id?;
                let item_id = proposal.item_id?;
                let target = self.actor_by_id(target_actor_id)?;
                if target.status == CW_ACTOR_ACTIVE
                    && target.location_id == actor.location_id
                    && self
                        .actor_held_items(actor.id)
                        .into_iter()
                        .any(|item| item.id == item_id)
                {
                    Some(CwAction {
                        kind: CW_ACTION_GIVE_ITEM,
                        actor_id: actor.id,
                        target_actor_id,
                        item_id,
                        ..CwAction::default()
                    })
                } else {
                    None
                }
            }
            "trade" => {
                let target_actor_id = proposal.target_actor_id?;
                let item_id = proposal.item_id?;
                let target_item_id = proposal.target_item_id?;
                Some(CwAction {
                    kind: CW_ACTION_TRADE_ITEM,
                    actor_id: actor.id,
                    target_actor_id,
                    item_id,
                    target_item_id,
                    ..CwAction::default()
                })
            }
            "use" => {
                let item_id = proposal.item_id?;
                if !self
                    .actor_held_items(actor.id)
                    .into_iter()
                    .any(|item| item.id == item_id)
                {
                    return None;
                }
                Some(CwAction {
                    kind: CW_ACTION_USE_ITEM,
                    actor_id: actor.id,
                    target_actor_id: proposal.target_actor_id.unwrap_or(0),
                    item_id,
                    ..CwAction::default()
                })
            }
            "open" => {
                let candidate_id = proposal.candidate_id.as_deref()?;
                let offer = self
                    .legal_action_candidates(Some(actor.id), &AccessContext::default())
                    .1
                    .into_iter()
                    .find(|offer| {
                        offer.kind == "open"
                            && offer.offer_id == candidate_id
                            && action_offer_is_reachable(offer)
                    })?;
                self.plan_threshold_method_offer_action(actor.id, &offer)
                    .ok()
            }
            FOCUSED_NOTICE_OFFER_KIND
            | DISCOVERY_SEARCH_OFFER_KIND
            | DISCOVERY_STUDY_OFFER_KIND
            | DISCOVERY_SCOUT_OFFER_KIND => {
                let candidate_id = proposal.candidate_id.as_deref()?;
                let composition_id = proposal.composition_id.as_deref()?;
                let state_revision = proposal.state_revision?;
                let offer = self
                    .legal_action_candidates(Some(actor.id), &AccessContext::default())
                    .1
                    .into_iter()
                    .find(|offer| {
                        offer.kind == proposal.kind
                            && offer.offer_id == candidate_id
                            && offer.composition_id == composition_id
                            && offer.state_revision == state_revision
                            && action_offer_is_reachable(offer)
                    })?;
                self.discovery_record_for_offer(actor.id, &offer, 0)
                    .ok()
                    .map(|record| record.action)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resident_continuity_projects_memories_and_survives_snapshots() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.beliefs.clear();
        runtime.resident_continuities.clear();

        runtime.remember_belief(
            RATI_ACTOR_ID,
            BELIEF_KIND_ACTOR_LOCATION,
            WHISKERWIND_ACTOR_ID,
            RAIN_SOFT_GARDEN_LOCATION_ID,
            BELIEF_TUNING.firsthand_confidence,
            BELIEF_TUNING.firsthand_salience,
            Some(RATI_ACTOR_ID),
        );
        runtime.refresh_resident_continuity(RATI_ACTOR_ID);

        let continuity = runtime
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .expect("Rati continuity is projected");
        assert_eq!(continuity.resident_id, RATI_ACTOR_ID);
        assert!(continuity.stable_identity.contains("Rati"));
        assert!(continuity
            .memory_atoms
            .iter()
            .any(|atom| atom.text.contains("Gust near Rain-Soft Garden")));
        assert!(format_resident_continuity(continuity).contains("i remember:"));

        let snapshot = RuntimeSnapshot::from_runtime(&runtime);
        assert!(snapshot.resident_continuities.is_empty());
        let restored = snapshot
            .into_runtime()
            .expect("snapshot restores resident continuity");
        let restored_continuity = restored
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .expect("Rati continuity survives reload");
        assert!(restored_continuity
            .memory_atoms
            .iter()
            .any(|atom| atom.text.contains("Gust near Rain-Soft Garden")));
    }

    #[test]
    fn committed_npc_speech_refreshes_resident_continuity() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.resident_continuities.clear();

        let content_id = runtime.next_content_id_value();
        let action = CwAction {
            kind: CW_ACTION_SAY,
            actor_id: RATI_ACTOR_ID,
            content_id,
            ..CwAction::default()
        };
        let mut record = JournalRecord::new(action, 7091);
        record.content_upserts.insert(
            content_id,
            "I will keep one stitch open for the room.".to_string(),
        );

        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        let speech_seq = events
            .iter()
            .find(|event| {
                event.type_name == "message.created" && event.actor_id == Some(RATI_ACTOR_ID)
            })
            .map(|event| event.seq)
            .expect("NPC speech event is committed");
        let continuity = runtime
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .expect("NPC speech refreshes resident continuity");
        assert!(continuity.last_observed_event_seq >= speech_seq);
        assert!(continuity
            .current_intent
            .as_deref()
            .map(|intent| !intent.trim().is_empty())
            .unwrap_or(false));
        let projected = runtime.resident_continuity_for(
            runtime
                .actor_by_id(RATI_ACTOR_ID)
                .expect("Rati remains in the seeded world"),
        );
        assert!(!projected.recent_voice_shingle_hashes.is_empty());
    }

    #[test]
    fn resident_voice_shingles_follow_the_speaker_across_rooms_and_exclude_other_speakers() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.recent_room_lines.clear();
        runtime.resident_continuities.clear();
        let rati_line =
            "Bethlehem at last! My biscuit survived the journey beneath the clear bells.";
        let other_line = "Only Gust keeps this unrelated lavender umbrella phrase in another room.";
        runtime.push_projected_event(EventView {
            seq: 9_001,
            type_name: "message.created".to_string(),
            success: true,
            actor_id: Some(RATI_ACTOR_ID),
            actor_name: Some("Rati".to_string()),
            location_id: Some(RAIN_SOFT_GARDEN_LOCATION_ID),
            content: Some(rati_line.to_string()),
            ..EventView::default()
        });
        runtime.push_projected_event(EventView {
            seq: 9_002,
            type_name: "message.created".to_string(),
            success: true,
            actor_id: Some(WHISKERWIND_ACTOR_ID),
            actor_name: Some("Gust".to_string()),
            location_id: Some(COSY_COTTAGE_LOCATION_ID),
            content: Some(other_line.to_string()),
            ..EventView::default()
        });

        let resident = runtime
            .actor_by_id(RATI_ACTOR_ID)
            .expect("Rati exists in the seeded world");
        let continuity = runtime.resident_continuity_for(resident);
        let own_hashes = crate::ai_publication::voice_signature_shingle_hashes(rati_line);
        let other_hashes = crate::ai_publication::voice_signature_shingle_hashes(other_line);

        assert!(own_hashes
            .iter()
            .any(|hash| continuity.recent_voice_shingle_hashes.contains(hash)));
        assert!(!other_hashes
            .iter()
            .any(|hash| continuity.recent_voice_shingle_hashes.contains(hash)));
        assert!(
            continuity.recent_voice_shingle_hashes.len() <= 192,
            "the persisted speaker memory stays bounded"
        );
    }

    #[test]
    fn resident_intent_projection_records_typed_continuity_notes() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.resident_continuities.clear();

        let proposal = AvatarIntentProposal {
            speech: "I will keep one stitch open for the room.".to_string(),
            intent: Some("listen for the next room need".to_string()),
            belief: Some("the cottage is waiting on a small kindness".to_string()),
            desire: Some("find who needs Moonwool Thread".to_string()),
            promise: Some("keep one stitch open".to_string()),
            refusal: Some("do not pretend the button has already moved".to_string()),
            proposed_action: Some(AvatarProposedAction {
                kind: "search".to_string(),
                target_actor_id: None,
                item_id: Some(DEWBRIGHT_BUTTON_ITEM_ID),
                destination_location_id: None,
                reason: Some("the scarf basket still has an unanswered clue".to_string()),
                ..AvatarProposedAction::default()
            }),
        };
        let content_id = runtime.next_content_id_value();
        let action = CwAction {
            kind: CW_ACTION_SAY,
            actor_id: RATI_ACTOR_ID,
            content_id,
            ..CwAction::default()
        };
        let mut record = JournalRecord::new(action, 7092);
        record
            .content_upserts
            .insert(content_id, proposal.speech.clone());
        record
            .projection_mutations
            .push(ProjectionMutation::UpdateResidentContinuity {
                resident_id: RATI_ACTOR_ID,
                proposal,
                reason: "test_resident_intent".to_string(),
            });

        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        let speech_seq = events
            .iter()
            .find(|event| {
                event.type_name == "message.created" && event.actor_id == Some(RATI_ACTOR_ID)
            })
            .map(|event| event.seq)
            .expect("NPC speech event committed");
        let continuity = runtime
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .expect("intent projection creates resident continuity");
        assert_eq!(
            continuity.current_intent.as_deref(),
            Some("listen for the next room need")
        );
        assert_eq!(
            continuity
                .pending_action
                .as_ref()
                .map(|action| action.kind.as_str()),
            Some("search")
        );
        assert!(continuity
            .beliefs
            .iter()
            .any(|note| note.text.contains("small kindness")));
        assert!(continuity
            .desires
            .iter()
            .any(|note| note.text.contains("Moonwool Thread")));
        assert!(continuity
            .promises
            .iter()
            .any(|note| note.text.contains("stitch open")));
        assert!(continuity
            .refusals
            .iter()
            .any(|note| note.text.contains("button has already moved")));
        assert!(continuity.last_observed_event_seq >= speech_seq);
        let formatted = format_resident_continuity(continuity);
        assert!(formatted.contains("i believe:"));
        assert!(formatted.contains("i want:"));
        assert!(formatted.contains("i promised:"));
        assert!(formatted.contains("i refuse:"));

        let snapshot_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-snapshot-continuity-{}-{}.json",
            std::process::id(),
            now_millis()
        ));
        let continuity_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-resident-continuity-{}-{}.json",
            std::process::id(),
            now_millis()
        ));
        let _ = fs::remove_file(&snapshot_path);
        let _ = fs::remove_file(&continuity_path);

        runtime
            .save_snapshot(&snapshot_path)
            .expect("world snapshot saves");
        runtime
            .save_resident_continuity_snapshot(&continuity_path)
            .expect("resident continuity artifact saves");
        let world_json = fs::read_to_string(&snapshot_path).expect("world snapshot readable");
        assert!(!world_json.contains("\"resident_continuities\""));
        assert!(world_json.contains("\"content_context\""));
        assert!(world_json.contains("pack://cosyworld.core/actor/1001"));
        let continuity_json =
            fs::read_to_string(&continuity_path).expect("continuity artifact readable");
        assert!(continuity_json.contains("\"version\": 1"));
        assert!(continuity_json.contains("\"residents\""));
        assert!(continuity_json.contains("\"promises\""));
        assert!(continuity_json.contains("\"recent_voice_shingle_hashes\""));

        let mut restored =
            RuntimeWorld::load_snapshot(&snapshot_path).expect("world snapshot restores");
        assert!(!restored
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .map(|continuity| continuity
                .promises
                .iter()
                .any(|note| note.text.contains("stitch open")))
            .unwrap_or(false));
        let applied = restored
            .load_resident_continuity_snapshot(&continuity_path)
            .expect("resident continuity artifact restores");
        assert!(applied >= 1);
        let restored_continuity = restored
            .resident_continuities
            .get(&RATI_ACTOR_ID)
            .expect("typed intent notes survive artifact reload");
        assert!(restored_continuity
            .promises
            .iter()
            .any(|note| note.text.contains("stitch open")));
        assert_eq!(
            restored_continuity
                .pending_action
                .as_ref()
                .map(|action| action.kind.as_str()),
            Some("search")
        );
        assert!(!restored_continuity.recent_voice_shingle_hashes.is_empty());

        let _ = fs::remove_file(snapshot_path);
        let _ = fs::remove_file(continuity_path);
    }

    #[test]
    fn persist_runtime_writes_resident_continuity_artifact() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.resident_continuities.clear();
        runtime.apply_resident_intent_projection(
            RATI_ACTOR_ID,
            &AvatarIntentProposal {
                speech: "I will keep one stitch open for the room.".to_string(),
                intent: Some("listen for the next room need".to_string()),
                belief: Some("the cottage is waiting on a small kindness".to_string()),
                desire: None,
                promise: Some("keep one stitch open".to_string()),
                refusal: None,
                proposed_action: None,
            },
            "test_persist_runtime",
        );

        let snapshot_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-persist-snapshot-{}-{}.json",
            std::process::id(),
            now_millis()
        ));
        let continuity_path = std::env::temp_dir().join(format!(
            "cosyworld-v2-persist-continuity-{}-{}.json",
            std::process::id(),
            now_millis()
        ));
        let _ = fs::remove_file(&snapshot_path);
        let _ = fs::remove_file(&continuity_path);

        let mut state = test_app_state(RuntimeWorld::seeded(), None);
        state.snapshot_path = Some(Arc::new(snapshot_path.clone()));
        state.resident_continuity_path = Some(Arc::new(continuity_path.clone()));
        persist_runtime(&state, &runtime);

        let world_json = fs::read_to_string(&snapshot_path).expect("world snapshot persisted");
        assert!(!world_json.contains("\"resident_continuities\""));
        let continuity_json =
            fs::read_to_string(&continuity_path).expect("continuity artifact persisted");
        assert!(continuity_json.contains("\"version\": 1"));
        assert!(continuity_json.contains("\"keep one stitch open\""));

        let _ = fs::remove_file(snapshot_path);
        let _ = fs::remove_file(continuity_path);
    }
}
