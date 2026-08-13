use super::*;

pub(super) const CRAFT_RECEIPT_SCHEMA_VERSION: u8 = 1;
pub(super) const HEARTH_TONIC_RECIPE_ID: u64 = 3105;
const CRAFT_ITEM_ID_BASE: u64 = 11_000_000_000;
const CRAFT_ITEM_ID_RANGE: u64 = 1_000_000_000;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct CraftInputState {
    pub(super) item_id: u64,
    pub(super) template_id: String,
    pub(super) zone: String,
    #[serde(default)]
    pub(super) charges_before: u8,
    pub(super) disposition: String,
    #[serde(default)]
    pub(super) source_origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) transition_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct CraftReceiptState {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) recipe_id: u64,
    pub(super) recipe_schema_version: u8,
    pub(super) recipe_key: String,
    pub(super) pack_id: String,
    pub(super) pack_version: String,
    pub(super) rules_profile: String,
    pub(super) actor_id: u64,
    pub(super) location_id: u64,
    pub(super) inputs: Vec<CraftInputState>,
    pub(super) output_item_id: u64,
    pub(super) output_template_id: String,
    pub(super) output_destination: String,
    #[serde(default)]
    pub(super) output_fallback_destination: String,
    pub(super) output_effect: String,
    #[serde(default)]
    pub(super) output_uniqueness: String,
    #[serde(default)]
    pub(super) capability_source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) craft_event_seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) output_event_seq: Option<u64>,
}

#[derive(Clone, Debug)]
pub(super) struct VersionedCraftPlan {
    pub(super) action: CwAction,
    pub(super) receipt: CraftReceiptState,
}

fn craft_disposition(value: &str) -> Option<u8> {
    match value {
        "persistent" => Some(CW_CRAFT_INPUT_PERSISTS),
        "consume" => Some(CW_CRAFT_INPUT_CONSUMED),
        "exhaust" => Some(CW_CRAFT_INPUT_EXHAUSTED),
        "transform" => Some(CW_CRAFT_INPUT_TRANSFORMED),
        _ => None,
    }
}

fn craft_zone(item: CwItem, actor_id: u64, location_id: u64) -> Option<&'static str> {
    if item.holder_actor_id == actor_id
        && item.location_id == 0
        && item.zone == CW_CARD_ZONE_CARRIED
    {
        Some("carried")
    } else if item.holder_actor_id == 0
        && item.location_id == location_id
        && item.zone == CW_CARD_ZONE_WORLD
    {
        Some("world")
    } else {
        None
    }
}

fn safe_craft_receipt_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

fn craft_item_id(receipt_id: &str, nonce: u8) -> u64 {
    CRAFT_ITEM_ID_BASE
        + stable_hash_u64(&["craft-item", receipt_id, &nonce.to_string()]) % CRAFT_ITEM_ID_RANGE
}

fn natural_resource_id(kind: NaturalResourceKind) -> &'static str {
    match kind {
        NaturalResourceKind::FishRichWater => "fish_rich_water",
        NaturalResourceKind::OreSeam => "ore_seam",
        NaturalResourceKind::ClayBank => "clay_bank",
        NaturalResourceKind::AncientWoodland => "ancient_woodland",
        NaturalResourceKind::FastRiver => "fast_river",
        NaturalResourceKind::ReliableUplandWind => "reliable_upland_wind",
        NaturalResourceKind::HotSpring => "hot_spring",
        NaturalResourceKind::RichSoil => "rich_soil",
        NaturalResourceKind::RareHerbHabitat => "rare_herb_habitat",
        NaturalResourceKind::OldRuins => "old_ruins",
    }
}

impl RuntimeWorld {
    pub(super) fn physical_item_template_id(&self, item_id: u64) -> Option<String> {
        self.physical_item_delivery_facts(item_id).template_id
    }

    pub(super) fn physical_item_delivery_facts(&self, item_id: u64) -> DeliveryItemFacts {
        let provenance = self
            .loot_allocations
            .values()
            .find_map(|allocation| {
                allocation
                    .item_ids
                    .iter()
                    .position(|candidate| *candidate == item_id)
                    .and_then(|index| allocation.selected_template_ids.get(index))
                    .map(|template_id| {
                        (
                            template_id.clone(),
                            allocation.pack_id.clone(),
                            allocation.pack_version.clone(),
                        )
                    })
            })
            .or_else(|| {
                self.craft_receipts
                    .values()
                    .find(|receipt| receipt.output_item_id == item_id)
                    .map(|receipt| {
                        (
                            receipt.output_template_id.clone(),
                            receipt.pack_id.clone(),
                            receipt.pack_version.clone(),
                        )
                    })
            });
        let Some((template_id, pack_id, pack_version)) = provenance else {
            return DeliveryItemFacts::default();
        };
        let tags = mounted_loot_item_template(&template_id)
            .filter(|mounted| mounted.pack_id == pack_id && mounted.pack_version == pack_version)
            .map(|mounted| mounted.template.delivery_tags.into_iter().collect())
            .unwrap_or_default();
        DeliveryItemFacts {
            template_id: Some(template_id),
            tags,
        }
    }

    fn versioned_recipe_capability_source(
        &self,
        _actor_id: u64,
        recipe: &SeedRecipeContent,
        location_id: u64,
    ) -> Option<String> {
        if !recipe.requires.building_capabilities.is_empty() {
            let building = self.settlement_buildings.values().find(|building| {
                building.location_id == location_id
                    && building.status == SettlementBuildingStatus::Completed
                    && building.access_policy == "public"
                    && !building.covenant_required
                    && recipe
                        .requires
                        .building_capabilities
                        .iter()
                        .all(|required| {
                            building
                                .installed_capabilities
                                .iter()
                                .any(|installed| installed == required)
                        })
                    && recipe.requires.recipe_tags.iter().all(|required| {
                        building
                            .recipe_tags
                            .iter()
                            .any(|installed| installed == required)
                    })
            })?;
            return Some(format!("building:{}", building.id));
        }
        if !recipe.requires.natural_features.iter().all(|required| {
            self.natural_affordances
                .get(&location_id)
                .and_then(|state| state.revealed_feature.as_ref())
                .is_some_and(|feature| natural_resource_id(feature.resource_kind) == required)
        }) || !recipe.requires.location_features.iter().all(|required| {
            if required == "generated_place_anchor_site" {
                return self.generated_places.contains_key(&location_id)
                    && !self
                        .tags
                        .get(&format!("generated-place:{location_id}:anchor-fixture"))
                        .is_some_and(|tag| tag.active);
            }
            required
                .strip_prefix("seed_room_feature:")
                .is_some_and(|feature_key| {
                    self.room_features(location_id)
                        .into_iter()
                        .any(|feature| feature.key == feature_key)
                })
        }) {
            return None;
        }
        if let Some(feature) = recipe.requires.natural_features.first() {
            return Some(format!("natural_feature:{feature}"));
        }
        if let Some(feature) = recipe.requires.location_features.first() {
            return Some(format!("location_feature:{feature}"));
        }
        None
    }

    fn versioned_recipe_inputs(
        &self,
        actor_id: u64,
        location_id: u64,
        recipe: &SeedRecipeContent,
    ) -> Option<Vec<(CwItem, String, String, String)>> {
        let mut candidates = self
            .actor_held_items(actor_id)
            .into_iter()
            .chain(self.loose_items_at_location(location_id))
            .collect::<Vec<_>>();
        candidates.sort_by_key(|item| item.id);
        let mut used = BTreeSet::new();
        let mut resolved = Vec::new();
        for input in &recipe.inputs {
            for _ in 0..input.quantity {
                let item = candidates.iter().copied().find(|item| {
                    if used.contains(&item.id)
                        || self.physical_item_template_id(item.id).as_deref()
                            != Some(input.template_id.as_str())
                        || item.charges < input.min_charges
                    {
                        return false;
                    }
                    craft_zone(*item, actor_id, location_id)
                        .is_some_and(|zone| input.zones.iter().any(|allowed| allowed == zone))
                })?;
                let zone = craft_zone(item, actor_id, location_id)?.to_string();
                used.insert(item.id);
                resolved.push((
                    item,
                    input.disposition.clone(),
                    zone,
                    input.template_id.clone(),
                ));
            }
        }
        Some(resolved)
    }

    fn actor_can_accept_craft_output(
        &self,
        actor_id: u64,
        inputs: &[(CwItem, String, String, String)],
        output: CwItem,
    ) -> bool {
        let Some(actor) = self.actor_by_id(actor_id) else {
            return false;
        };
        let removed = inputs
            .iter()
            .filter(|(_, disposition, _, _)| {
                matches!(disposition.as_str(), "consume" | "transform")
            })
            .map(|(item, _, _, _)| item.id)
            .collect::<BTreeSet<_>>();
        let mut weight = 0u32;
        let mut capacity = actor_base_carrying_capacity_tenths(actor);
        for item in self.actor_held_items(actor_id) {
            if removed.contains(&item.id) {
                continue;
            }
            weight += u32::from(effective_item_weight_tenths(item));
            if item.role == CW_ITEM_ROLE_CONTAINER
                && item.zone == CW_CARD_ZONE_EQUIPPED
                && item.container_item_id == 0
            {
                capacity += u32::from(item.container_capacity_tenths);
            }
        }
        weight += u32::from(effective_item_weight_tenths(output));
        weight <= capacity
    }

    pub(super) fn versioned_craft_plan(
        &self,
        actor_id: u64,
        recipe_id: u64,
        requested_receipt_id: Option<&str>,
    ) -> Option<VersionedCraftPlan> {
        let actor = self.actor_by_id(actor_id)?;
        if actor.status != CW_ACTOR_ACTIVE {
            return None;
        }
        let recipe = self.recipe_by_id(recipe_id)?;
        if recipe.schema_version != 2 {
            return None;
        }
        let capability_source =
            self.versioned_recipe_capability_source(actor_id, recipe, actor.location_id)?;
        let inputs = self.versioned_recipe_inputs(actor_id, actor.location_id, recipe)?;
        let output = recipe.output.as_ref()?;
        if output.uniqueness == "per_world"
            && self
                .craft_receipts
                .values()
                .any(|receipt| receipt.output_template_id == output.template_id)
        {
            return None;
        }
        if output.uniqueness == "per_location"
            && self.craft_receipts.values().any(|receipt| {
                receipt.output_template_id == output.template_id
                    && receipt.location_id == actor.location_id
                    && receipt.output_effect == output.effect
            })
        {
            return None;
        }
        let mounted = mounted_loot_item_template(&output.template_id)?;
        let receipt_id = requested_receipt_id.map(str::to_string).unwrap_or_else(|| {
            format!(
                "craft:{}:{}:{}",
                actor_id, recipe.id, self.world.next_event_seq
            )
        });
        if !safe_craft_receipt_id(&receipt_id) || self.craft_receipts.contains_key(&receipt_id) {
            return None;
        }
        let output_item_id = (0..=u8::MAX)
            .map(|nonce| craft_item_id(&receipt_id, nonce))
            .find(|item_id| self.item_by_id(*item_id).is_none())?;
        let template = &mounted.template;
        let output_kind = seed_item_kind_from_str(&template.kind)?;
        let output_role = loot_item_role(&template.role)?;
        let output_profile = CwItem {
            id: output_item_id,
            kind: output_kind,
            charges: template.charges,
            weight_tenths: template.weight_tenths,
            container_capacity_tenths: template.container_capacity_tenths,
            size_class: item_size_from_str(&template.size)?,
            role: output_role,
            zone: CW_CARD_ZONE_CARRIED,
            holder_actor_id: actor_id,
            ..CwItem::default()
        };
        let requested_destination = output.destination.as_str();
        let destination = if requested_destination == "actor_hand"
            && self.actor_can_accept_craft_output(actor_id, &inputs, output_profile)
        {
            "actor_hand"
        } else if matches!(
            requested_destination,
            "location_floor" | "installed_at_location"
        ) || output.fallback_destination == "location_floor"
        {
            if requested_destination == "installed_at_location" {
                "installed_at_location"
            } else {
                "location_floor"
            }
        } else {
            return None;
        };
        let (output_target_kind, output_target_id) = match destination {
            "actor_hand" => (CW_PLACEMENT_ACTOR_HAND, actor_id),
            "installed_at_location" => (CW_PLACEMENT_LOCATION_FIXTURE, actor.location_id),
            _ => (CW_PLACEMENT_LOCATION_FLOOR, actor.location_id),
        };
        let first = inputs.first();
        let second = inputs.get(1);
        let action = CwAction {
            kind: CW_ACTION_CRAFT,
            actor_id,
            content_id: recipe.id,
            item_id: first.map(|input| input.0.id).unwrap_or_default(),
            target_item_id: second.map(|input| input.0.id).unwrap_or_default(),
            output_item_id,
            output_target_id,
            output_target_kind,
            output_item_kind: output_kind,
            output_item_charges: template.charges,
            output_item_weight_tenths: template.weight_tenths,
            output_container_capacity_tenths: template.container_capacity_tenths,
            output_item_size_class: output_profile.size_class,
            output_item_role: output_role,
            item_disposition: first
                .map(|input| craft_disposition(&input.1))
                .unwrap_or(Some(CW_CRAFT_INPUT_PERSISTS))?,
            target_item_disposition: second
                .map(|input| craft_disposition(&input.1))
                .unwrap_or(Some(CW_CRAFT_INPUT_PERSISTS))?,
            ..CwAction::default()
        };
        let pack_id = if recipe.pack_id.is_empty() {
            mounted.pack_id.clone()
        } else {
            recipe.pack_id.clone()
        };
        let pack_version = active_content()
            .manifest
            .packs
            .iter()
            .find(|pack| pack.id == pack_id)
            .map(|pack| pack.version.clone())
            .unwrap_or_else(|| mounted.pack_version.clone());
        let receipt_inputs = inputs
            .into_iter()
            .map(|(item, disposition, zone, template_id)| CraftInputState {
                item_id: item.id,
                template_id,
                zone,
                charges_before: item.charges,
                disposition,
                source_origin: self
                    .item_provenance
                    .get(&item.id)
                    .map(|state| state.origin.clone())
                    .unwrap_or_else(|| "runtime".to_string()),
                transition_event_seq: None,
            })
            .collect();
        Some(VersionedCraftPlan {
            action,
            receipt: CraftReceiptState {
                schema_version: CRAFT_RECEIPT_SCHEMA_VERSION,
                id: receipt_id,
                recipe_id: recipe.id,
                recipe_schema_version: recipe.schema_version,
                recipe_key: recipe.key.clone(),
                pack_id,
                pack_version,
                rules_profile: active_content().manifest.rules_profile.clone(),
                actor_id,
                location_id: actor.location_id,
                inputs: receipt_inputs,
                output_item_id,
                output_template_id: output.template_id.clone(),
                output_destination: destination.to_string(),
                output_fallback_destination: output.fallback_destination.clone(),
                output_effect: output.effect.clone(),
                output_uniqueness: output.uniqueness.clone(),
                capability_source,
                craft_event_seq: None,
                output_event_seq: None,
            },
        })
    }

    pub(super) fn apply_craft_resolution(
        &mut self,
        receipt: &CraftReceiptState,
        committed_events: &[EventView],
    ) {
        if self.craft_receipts.contains_key(&receipt.id) {
            return;
        }
        let Some(craft_event) = committed_events.iter().find(|event| {
            event.success
                && event.type_name == "item.crafted"
                && event.content_id == Some(receipt.recipe_id)
                && event.actor_id == Some(receipt.actor_id)
        }) else {
            return;
        };
        let Some(output_event) = committed_events.iter().find(|event| {
            event.success
                && event.type_name == "item.created"
                && event.item_id == Some(receipt.output_item_id)
        }) else {
            return;
        };
        let Some(mounted) = mounted_loot_item_template(&receipt.output_template_id) else {
            return;
        };
        let template = mounted.template;
        let Some(item) = self.world.items[..self.world.item_count]
            .iter_mut()
            .find(|item| item.id == receipt.output_item_id)
        else {
            return;
        };
        let Some(kind) = seed_item_kind_from_str(&template.kind) else {
            return;
        };
        let Some(role) = loot_item_role(&template.role) else {
            return;
        };
        let Some(size_class) = item_size_from_str(&template.size) else {
            return;
        };
        item.kind = kind;
        item.charges = template.charges;
        item.weight_tenths = template.weight_tenths;
        item.container_capacity_tenths = template.container_capacity_tenths;
        item.size_class = size_class;
        item.role = role;
        self.items.insert(
            receipt.output_item_id,
            ItemMeta {
                name: template.name,
                description: template.description,
                skill_id: None,
                skill_bonus: 0,
                mechanics: template.mechanics,
            },
        );
        let current_holder_actor_id = opt_id(item.holder_actor_id);
        let current_location_id = opt_id(item.location_id);
        self.item_provenance.insert(
            receipt.output_item_id,
            ItemProvenanceState {
                item_id: receipt.output_item_id,
                origin: format!(
                    "craft:{}@{}:{}@{}",
                    receipt.recipe_key,
                    receipt.recipe_schema_version,
                    receipt.pack_id,
                    receipt.pack_version
                ),
                acquisition: "item.created".to_string(),
                previous_holder_actor_id: None,
                current_holder_actor_id,
                current_location_id,
                transfer_count: 0,
                source_event_seq: Some(output_event.seq),
                possession_journey: current_holder_actor_id.map(|actor_id| {
                    PossessionJourneyState::new(actor_id, receipt.location_id, output_event.seq)
                }),
            },
        );
        let mut committed = receipt.clone();
        committed.craft_event_seq = Some(craft_event.seq);
        committed.output_event_seq = Some(output_event.seq);
        for input in &mut committed.inputs {
            let event_type = match input.disposition.as_str() {
                "consume" => "item.consumed",
                "exhaust" => "item.exhausted",
                "transform" => "item.transformed",
                _ => continue,
            };
            input.transition_event_seq = committed_events
                .iter()
                .find(|event| {
                    event.success
                        && event.type_name == event_type
                        && event.item_id == Some(input.item_id)
                })
                .map(|event| event.seq);
            if let Some(provenance) = self.item_provenance.get_mut(&input.item_id) {
                provenance.acquisition = event_type.to_string();
                provenance.source_event_seq = input.transition_event_seq;
                if matches!(input.disposition.as_str(), "consume" | "transform") {
                    provenance.previous_holder_actor_id = provenance.current_holder_actor_id;
                    provenance.current_holder_actor_id = None;
                    provenance.current_location_id = None;
                    provenance.possession_journey = None;
                }
            }
        }
        if receipt.output_effect == "installed_fixture" {
            let tag_id = format!("generated-place:{}:anchor-fixture", receipt.location_id);
            self.tags.entry(tag_id.clone()).or_insert(RpgTagState {
                id: tag_id,
                scope: "room".to_string(),
                scope_id: receipt.location_id,
                label: "crafted anchor fixture".to_string(),
                kind: "boon".to_string(),
                active: true,
                source_event_seq: Some(output_event.seq),
                expires: None,
            });
            if let Some((clock_id, job_id)) = self
                .generated_places
                .get(&receipt.location_id)
                .map(|place| (place.anchor_clock_id.clone(), place.anchor_job_id.clone()))
            {
                if let Some(clock) = self.clocks.get_mut(&clock_id) {
                    clock.filled = clock.segments;
                    clock.status = "completed".to_string();
                    clock.updated_event_seq = Some(output_event.seq);
                }
                if let Some(job) = self.jobs.get_mut(&job_id) {
                    job.status = "completed".to_string();
                }
            }
        }
        self.craft_receipts.insert(committed.id.clone(), committed);
    }

    pub(super) fn refresh_craft_event_presentation(&self, events: &mut [EventView]) {
        for event in events {
            if event.item_name.is_none() {
                event.item_name = event.item_id.and_then(|item_id| self.item_name(item_id));
            }
            if event.target_item_name.is_none() {
                event.target_item_name = event
                    .target_item_id
                    .and_then(|item_id| self.item_name(item_id));
            }
            let receipt = self.craft_receipts.values().find(|receipt| {
                receipt.craft_event_seq == Some(event.seq)
                    || receipt.output_event_seq == Some(event.seq)
                    || receipt
                        .inputs
                        .iter()
                        .any(|input| input.transition_event_seq == Some(event.seq))
            });
            let Some(receipt) = receipt else {
                continue;
            };
            let recipe_name = self
                .recipe_name(receipt.recipe_id)
                .unwrap_or_else(|| "Craft".to_string());
            let input_name = receipt
                .inputs
                .first()
                .and_then(|input| self.item_name(input.item_id))
                .unwrap_or_else(|| "the materials".to_string());
            let output_name = self
                .item_name(receipt.output_item_id)
                .unwrap_or_else(|| "the finished piece".to_string());
            event.content = Some(match event.type_name.as_str() {
                "item.crafted" if receipt.output_effect == "provisioned_supply" => {
                    format!("{recipe_name}: {output_name} was drawn from the local supply.")
                }
                "item.crafted" => format!("{recipe_name}: {input_name} became {output_name}."),
                "item.created" if receipt.output_effect == "installed_fixture" => {
                    format!("{output_name} now anchors this place.")
                }
                "item.created" => format!("{output_name} is ready here."),
                "item.consumed" => format!("{input_name} was used up."),
                "item.exhausted" => format!("{input_name} needs restoring."),
                "item.transformed" => format!("{input_name} became {output_name}."),
                _ => continue,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_ORE_ITEM_ID: u64 = 9_123_456_789;

    fn install_completed_smithy(runtime: &mut RuntimeWorld, location_id: u64) {
        runtime.settlement_buildings.insert(
            "test-smithy".to_string(),
            SettlementBuildingState {
                schema_version: SETTLEMENT_BUILDING_SCHEMA_VERSION,
                id: "test-smithy".to_string(),
                location_id,
                slot_index: 1,
                slot_class: "major".to_string(),
                archetype_id: "smithy".to_string(),
                name: "Smithy".to_string(),
                pack_id: "cosyworld.core".to_string(),
                pack_version: runtime.active_pack_version("cosyworld.core"),
                governance_decision_id: "test".to_string(),
                selected_event_seq: 1,
                construction_clock_id: "test-smithy-clock".to_string(),
                construction_job_id: "test-smithy-job".to_string(),
                status: SettlementBuildingStatus::Completed,
                completed_event_seq: Some(2),
                declared_capabilities: vec![
                    "transformation_recipes".to_string(),
                    "metalworking".to_string(),
                ],
                installed_capabilities: vec![
                    "transformation_recipes".to_string(),
                    "metalworking".to_string(),
                ],
                quest_templates: Vec::new(),
                recipe_tags: vec!["smithy".to_string(), "refinement".to_string()],
                access_policy: "public".to_string(),
                covenant_required: false,
                loot_table_id: None,
                public_cache: None,
                upgrade_clock_id: None,
                upgrade_job_id: None,
                upgrade_level: 0,
                upgraded_event_seq: None,
                follow_up_job_ids: Vec::new(),
            },
        );
    }

    fn place_quest_ore(runtime: &mut RuntimeWorld, location_id: u64) {
        let item = CwItem {
            id: TEST_ORE_ITEM_ID,
            kind: CW_ITEM_KEEPSAKE,
            charges: 1,
            weight_tenths: 20,
            size_class: CW_ITEM_SIZE_SMALL,
            role: CW_ITEM_ROLE_GENERIC,
            zone: CW_CARD_ZONE_WORLD,
            location_id,
            ..CwItem::default()
        };
        runtime.world.items[runtime.world.item_count] = item;
        runtime.world.item_count += 1;
        runtime.items.insert(
            TEST_ORE_ITEM_ID,
            ItemMeta {
                name: "Iron Nodule".to_string(),
                description: "Quest ore.".to_string(),
                skill_id: None,
                skill_bonus: 0,
                mechanics: None,
            },
        );
        runtime.item_provenance.insert(
            TEST_ORE_ITEM_ID,
            ItemProvenanceState {
                item_id: TEST_ORE_ITEM_ID,
                origin: "loot:cosyworld.core:loot/shallow-mine-ore@1".to_string(),
                acquisition: "quest.loot_allocated".to_string(),
                previous_holder_actor_id: None,
                current_holder_actor_id: None,
                current_location_id: Some(location_id),
                transfer_count: 0,
                source_event_seq: Some(1),
                possession_journey: None,
            },
        );
        runtime.loot_allocations.insert(
            "test-mine-loot".to_string(),
            LootAllocationState {
                schema_version: QUEST_LOOT_SCHEMA_VERSION,
                id: "test-mine-loot".to_string(),
                job_id: "test-mine-job".to_string(),
                quest_template_id: "production.shallow_mine".to_string(),
                table_id: "cosyworld.core:loot/shallow-mine-ore".to_string(),
                table_version: 1,
                replay_version: "weighted-fnv1a-v1".to_string(),
                pack_id: "cosyworld.core".to_string(),
                pack_version: runtime.active_pack_version("cosyworld.core"),
                rules_profile: active_content().manifest.rules_profile.clone(),
                completion_event_seq: 1,
                allocation_event_seq: 2,
                roll_seed: 3,
                roll_input: "test".to_string(),
                selected_template_ids: vec!["iron_nodule".to_string()],
                item_ids: vec![TEST_ORE_ITEM_ID],
                allocation_policy: "building_public_cache".to_string(),
                destination_kind: "location_stockpile".to_string(),
                destination_id: format!("location:{location_id}:stockpile"),
                recipient_actor_id: None,
                location_id,
            },
        );
    }

    fn commit_plan(runtime: &mut RuntimeWorld, plan: VersionedCraftPlan) -> (u32, Vec<EventView>) {
        let mut record = JournalRecord::new(plan.action, runtime.next_seed_value());
        record
            .projection_mutations
            .push(ProjectionMutation::ResolveCraft {
                receipt: plan.receipt,
            });
        runtime.apply_journal_record(&record)
    }

    fn record_for_plan(runtime: &RuntimeWorld, plan: VersionedCraftPlan) -> JournalRecord {
        let mut record = JournalRecord::new(plan.action, runtime.next_seed_value());
        record
            .projection_mutations
            .push(ProjectionMutation::ResolveCraft {
                receipt: plan.receipt,
            });
        record
    }

    fn prepared_craft_runtime(location_id: u64) -> RuntimeWorld {
        let mut runtime = RuntimeWorld::seeded();
        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("seed actor")
            .location_id = location_id;
        place_quest_ore(&mut runtime, location_id);
        install_completed_smithy(&mut runtime, location_id);
        runtime
    }

    #[test]
    fn hearth_tonic_supply_is_repeatable_for_players_and_replay_safe() {
        let mut runtime = RuntimeWorld::seeded();
        const FIRST_PLAYER_ID: u64 = 5_000;
        const SECOND_PLAYER_ID: u64 = 5_001;
        create_test_human(
            &mut runtime,
            FIRST_PLAYER_ID,
            COSY_COTTAGE_LOCATION_ID,
            "First Player",
        );
        create_test_human(
            &mut runtime,
            SECOND_PLAYER_ID,
            COSY_COTTAGE_LOCATION_ID,
            "Second Player",
        );
        let replay_base = RuntimeSnapshot::from_runtime(&runtime);
        let first_plan = runtime
            .versioned_craft_plan(
                FIRST_PLAYER_ID,
                HEARTH_TONIC_RECIPE_ID,
                Some("hearth-tonic:first-player:first"),
            )
            .expect("the Cottage hearth provisions the first player a tonic");
        assert!(first_plan.receipt.inputs.is_empty());
        assert_eq!(
            first_plan.receipt.capability_source,
            "location_feature:seed_room_feature:hearth"
        );
        assert_eq!(first_plan.action.item_id, 0);
        let first_record = record_for_plan(&runtime, first_plan);
        assert_eq!(runtime.apply_journal_record(&first_record).0, CW_OK);
        let first_tonic_id = runtime
            .craft_receipts
            .get("hearth-tonic:first-player:first")
            .expect("the first player's claim is durable")
            .output_item_id;

        let second_plan = runtime
            .versioned_craft_plan(
                SECOND_PLAYER_ID,
                HEARTH_TONIC_RECIPE_ID,
                Some("hearth-tonic:second-player:first"),
            )
            .expect("the same hearth independently provisions the second player");
        let second_record = record_for_plan(&runtime, second_plan);
        assert_eq!(runtime.apply_journal_record(&second_record).0, CW_OK);
        let second_tonic_id = runtime
            .craft_receipts
            .get("hearth-tonic:second-player:first")
            .expect("the second player's claim is durable")
            .output_item_id;
        assert_ne!(first_tonic_id, second_tonic_id);
        assert!(runtime.item_by_id(first_tonic_id).is_some_and(|item| {
            item.holder_actor_id == FIRST_PLAYER_ID
                && item.kind == CW_ITEM_POTION
                && item.charges == 1
        }));
        assert!(runtime.item_by_id(second_tonic_id).is_some_and(|item| {
            item.holder_actor_id == SECOND_PLAYER_ID
                && item.kind == CW_ITEM_POTION
                && item.charges == 1
        }));
        assert!(runtime
            .versioned_craft_plan(
                FIRST_PLAYER_ID,
                HEARTH_TONIC_RECIPE_ID,
                Some("hearth-tonic:first-player:first"),
            )
            .is_none());

        let expected_receipts = runtime.craft_receipts.clone();
        let expected_items = serde_json::to_value(&runtime.world.items[..runtime.world.item_count])
            .expect("provisioned items serialize");
        let mut replayed = replay_base
            .into_runtime()
            .expect("pre-provision snapshot restores");
        assert_eq!(replayed.apply_journal_record(&first_record).0, CW_OK);
        assert_eq!(replayed.apply_journal_record(&second_record).0, CW_OK);
        assert_eq!(replayed.craft_receipts, expected_receipts);
        assert_eq!(
            serde_json::to_value(&replayed.world.items[..replayed.world.item_count])
                .expect("replayed provisioned items serialize"),
            expected_items
        );
    }

    #[test]
    fn resident_with_a_healing_target_draws_then_uses_a_hearth_tonic() {
        let mut runtime = RuntimeWorld::seeded();
        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati exists")
            .damage = 6;
        for item in runtime.world.items[..runtime.world.item_count]
            .iter_mut()
            .filter(|item| item.kind == CW_ITEM_POTION)
        {
            item.charges = 0;
        }
        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati exists")
            .location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        let rati = runtime
            .actor_by_id(RATI_ACTOR_ID)
            .expect("Rati remains active");
        let blocked_motive = runtime
            .resident_economy_view(rati, None)
            .expect("Rati economy is visible away from the hearth")
            .motive;
        assert_eq!(
            blocked_motive,
            "Rati cannot help Rati yet: no usable potion is available here. A Hearth Tonic can be drawn from the Cottage hearth."
        );
        runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati exists")
            .location_id = COSY_COTTAGE_LOCATION_ID;
        let rati = runtime
            .actor_by_id(RATI_ACTOR_ID)
            .expect("Rati remains active");
        let motive = runtime
            .resident_economy_view(rati, None)
            .expect("Rati economy is visible")
            .motive;
        assert_eq!(
            motive,
            "Rati can draw a Hearth Tonic from the Cottage hearth to help Rati."
        );

        let provision = runtime
            .resident_economy_autonomy_record(rati, 81_101)
            .expect("healing need selects a legal provision action");
        assert_eq!(provision.action.kind, CW_ACTION_CRAFT);
        assert_eq!(provision.action.content_id, HEARTH_TONIC_RECIPE_ID);
        assert!(provision
            .projection_mutations
            .iter()
            .any(|mutation| matches!(mutation, ProjectionMutation::ResolveCraft { .. })));
        assert_eq!(runtime.apply_journal_record(&provision).0, CW_OK);

        let rati = runtime
            .actor_by_id(RATI_ACTOR_ID)
            .expect("Rati remains active");
        let healing = runtime
            .resident_economy_autonomy_record(rati, 81_102)
            .expect("fresh tonic creates a legal healing action");
        assert_eq!(healing.action.kind, CW_ACTION_USE_ITEM);
        assert_eq!(healing.action.target_actor_id, RATI_ACTOR_ID);
        assert_eq!(runtime.apply_journal_record(&healing).0, CW_OK);
        assert_eq!(
            runtime
                .actor_by_id(RATI_ACTOR_ID)
                .expect("Rati remains active")
                .damage,
            0
        );

        assert!(runtime
            .versioned_craft_plan(
                RATI_ACTOR_ID,
                HEARTH_TONIC_RECIPE_ID,
                Some("hearth-tonic:rati:again"),
            )
            .is_some());
    }

    fn test_generated_pathway(runtime: &RuntimeWorld) -> GeneratedPathwayState {
        let mut pathway = runtime
            .generated_pathway(
                RATI_ACTOR_ID,
                COSY_COTTAGE_LOCATION_ID,
                RAIN_SOFT_GARDEN_LOCATION_ID,
                2,
            )
            .expect("canonical test pathway");
        pathway.revealed_edges.insert(pathway_edge_key(
            pathway.origin_location_id,
            pathway.waypoints[0].id,
        ));
        pathway
    }

    #[test]
    fn resident_craft_uses_the_player_typed_recipe_offer_and_replays() {
        let location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        let mut runtime = prepared_craft_runtime(location_id);
        let local_clock_ids = runtime
            .jobs
            .values()
            .filter(|job| job.location_ids.contains(&location_id))
            .map(|job| job.progress_clock_id.clone())
            .collect::<Vec<_>>();
        for clock_id in local_clock_ids {
            if let Some(clock) = runtime.clocks.get_mut(&clock_id) {
                clock.filled = clock.segments;
            }
        }
        let actor = runtime.actor_by_id(RATI_ACTOR_ID).expect("Rati exists");
        runtime.append_location_search_event(
            actor.id,
            location_id,
            "already looked here",
            "search_location",
        );
        let offer = runtime
            .legal_action_candidates(Some(actor.id), &AccessContext::default())
            .1
            .into_iter()
            .find(|offer| {
                offer.kind == "craft"
                    && offer
                        .target
                        .as_ref()
                        .is_some_and(|target| target.id == Some(3101))
            })
            .expect("the player candidate surface offers the typed recipe");
        let record = runtime
            .resident_economy_autonomy_record(actor, 81_001)
            .expect("the resident selects the same Craft offer");
        assert_eq!(record.origin, JournalOrigin::ActorConsequence);
        assert_eq!(record.action.kind, CW_ACTION_CRAFT);
        assert_eq!(record.action.content_id, 3101);
        assert_eq!(record.rules_action, offer.rules_action);
        assert_eq!(record.operation, offer.operation);
        assert_eq!(record.resolver.as_deref(), Some(offer.resolver.as_str()));
        assert!(record
            .projection_mutations
            .iter()
            .any(|mutation| matches!(mutation, ProjectionMutation::ResolveCraft { .. })));
        let replay_base = RuntimeSnapshot::from_runtime(&runtime);

        let (status, events) = runtime.apply_journal_record(&record);
        assert_eq!(status, CW_OK);
        assert!(events.iter().any(|event| {
            event.type_name == "item.crafted" && event.actor_id == Some(actor.id)
        }));
        assert!(runtime
            .resident_record_for_shared_offer(actor, &offer, 81_001)
            .is_none());
        let expected_receipts = runtime.craft_receipts.clone();
        let expected_items = serde_json::to_value(&runtime.world.items[..runtime.world.item_count])
            .expect("crafted items serialize");
        let mut replayed = replay_base
            .into_runtime()
            .expect("pre-craft snapshot restores");
        assert_eq!(replayed.apply_journal_record(&record).0, CW_OK);
        assert_eq!(replayed.craft_receipts, expected_receipts);
        assert_eq!(
            serde_json::to_value(&replayed.world.items[..replayed.world.item_count])
                .expect("replayed items serialize"),
            expected_items
        );
    }

    #[test]
    fn quest_ore_requires_a_smithy_and_transforms_exactly_once() {
        let mut runtime = RuntimeWorld::seeded();
        let location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        let actor = runtime
            .world
            .actors
            .iter_mut()
            .take(runtime.world.actor_count)
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("seed actor");
        actor.location_id = location_id;
        place_quest_ore(&mut runtime, location_id);
        let item_count_before_building = runtime.world.item_count;
        assert!(runtime
            .versioned_craft_plan(RATI_ACTOR_ID, 3101, Some("test-refine"))
            .is_none());

        install_completed_smithy(&mut runtime, location_id);
        assert_eq!(runtime.world.item_count, item_count_before_building);
        {
            let smithy = runtime
                .settlement_buildings
                .get_mut("test-smithy")
                .expect("test smithy");
            smithy.access_policy = "covenant".to_string();
            smithy.covenant_required = true;
        }
        assert!(runtime
            .versioned_craft_plan(RATI_ACTOR_ID, 3101, Some("closed-smithy"))
            .is_none());
        {
            let smithy = runtime
                .settlement_buildings
                .get_mut("test-smithy")
                .expect("test smithy");
            smithy.access_policy = "public".to_string();
            smithy.covenant_required = false;
        }
        for item in runtime.world.items[..runtime.world.item_count]
            .iter_mut()
            .filter(|item| item.holder_actor_id == RATI_ACTOR_ID)
        {
            item.holder_actor_id = 0;
            item.location_id = 0;
            item.zone = CW_CARD_ZONE_WORLD;
        }
        let mut kernel_offers = CwActionOffers::default();
        assert_eq!(
            unsafe { cw_get_action_offers(&*runtime.world, RATI_ACTOR_ID, &mut kernel_offers) },
            CW_OK
        );
        assert_eq!(kernel_offers.option_flags & CW_OFFER_CRAFT, 0);
        assert!(runtime
            .primary_action(Some(RATI_ACTOR_ID), &AccessContext::default())
            .options
            .iter()
            .any(|option| option.kind == "craft"));
        let direct_plan = runtime
            .versioned_craft_plan(RATI_ACTOR_ID, 3101, Some("test-refine"))
            .expect("smithy exposes refinement");
        assert_eq!(
            direct_plan.receipt.capability_source,
            "building:test-smithy"
        );
        assert_eq!(
            direct_plan.action.item_disposition,
            CW_CRAFT_INPUT_TRANSFORMED
        );
        runtime
            .actor_autonomy
            .entry(RATI_ACTOR_ID)
            .or_default()
            .control_mode = ActorControlMode::RoamingAi;
        runtime.callings.insert(
            RATI_ACTOR_ID,
            CallingState {
                actor_id: RATI_ACTOR_ID,
                statement: "Courier".to_string(),
                source_event_seq: Some(1),
            },
        );
        runtime.actor_practices.insert(
            RATI_ACTOR_ID,
            ActorPracticeState {
                primary: Some(DeedCategory::Exploration),
                ..ActorPracticeState::default()
            },
        );
        assert!(runtime
            .versioned_craft_plan(RATI_ACTOR_ID, 3101, Some("other-controller"))
            .is_some());

        let (status, events) = commit_plan(&mut runtime, direct_plan);
        assert_eq!(status, CW_OK);
        assert!(runtime.item_by_id(TEST_ORE_ITEM_ID).is_none());
        let receipt = runtime
            .craft_receipts
            .get("test-refine")
            .expect("durable craft receipt");
        let bloom_item_id = receipt.output_item_id;
        assert_eq!(
            receipt.inputs[0].source_origin,
            "loot:cosyworld.core:loot/shallow-mine-ore@1"
        );
        assert_eq!(
            runtime.item_provenance[&bloom_item_id].origin,
            "craft:refine-iron-bloom@2:cosyworld.core@1.3.13"
        );
        assert_eq!(
            events
                .iter()
                .filter(|event| event.type_name == "item.created")
                .count(),
            1
        );
        assert!(events.iter().any(|event| {
            event.type_name == "item.crafted"
                && event
                    .content
                    .as_deref()
                    .is_some_and(|line| line == "Refine Iron Bloom: Iron Nodule became Iron Bloom.")
        }));
        let deed_count = runtime.deeds.len();
        assert!(runtime
            .versioned_craft_plan(RATI_ACTOR_ID, 3101, Some("test-refine"))
            .is_none());
        assert_eq!(runtime.world.item_count, item_count_before_building);
        assert_eq!(runtime.deeds.len(), deed_count);

        let drop_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_DROP_ITEM,
                actor_id: RATI_ACTOR_ID,
                item_id: bloom_item_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        );
        assert_eq!(runtime.apply_journal_record(&drop_record).0, CW_OK);
        assert_eq!(
            runtime
                .item_by_id(bloom_item_id)
                .map(|item| item.location_id),
            Some(location_id)
        );
        let pickup_record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_PICK_UP_ITEM,
                actor_id: RATI_ACTOR_ID,
                item_id: bloom_item_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        );
        assert_eq!(runtime.apply_journal_record(&pickup_record).0, CW_OK);
        assert_eq!(
            runtime
                .item_by_id(bloom_item_id)
                .map(|item| item.holder_actor_id),
            Some(RATI_ACTOR_ID)
        );

        let forge_plan = runtime
            .versioned_craft_plan(RATI_ACTOR_ID, 3102, Some("test-anchor"))
            .expect("portable bloom can become a portable bracket");
        let (forge_status, _) = commit_plan(&mut runtime, forge_plan);
        assert_eq!(forge_status, CW_OK);
        assert!(runtime
            .versioned_craft_plan(RATI_ACTOR_ID, 3103, Some("test-install"))
            .is_none());

        let pathway = test_generated_pathway(&runtime);
        let generated_location_id = pathway.waypoints[0].id;
        runtime
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        runtime.ensure_generated_pathway_edge(
            &pathway,
            pathway.origin_location_id,
            generated_location_id,
        );
        runtime.ensure_generated_place_for_waypoint(
            &pathway,
            generated_location_id,
            COSY_COTTAGE_LOCATION_ID,
        );
        runtime.world.actors[..runtime.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati remains present")
            .location_id = generated_location_id;
        let bracket_item_id = runtime
            .craft_receipts
            .get("test-anchor")
            .expect("forge receipt")
            .output_item_id;
        assert_eq!(
            runtime
                .physical_item_template_id(bracket_item_id)
                .as_deref(),
            Some("waystone_bracket")
        );
        assert!(runtime.item_by_id(bracket_item_id).is_some());
        assert!(runtime
            .versioned_recipe_capability_source(
                RATI_ACTOR_ID,
                runtime.recipe_by_id(3103).expect("install recipe"),
                generated_location_id,
            )
            .is_some());
        let anchor_plan = runtime
            .versioned_craft_plan(RATI_ACTOR_ID, 3103, Some("test-install"))
            .expect("portable bracket can be installed at an unfinished place");
        let (anchor_status, _) = commit_plan(&mut runtime, anchor_plan);
        assert_eq!(anchor_status, CW_OK);
        let installed_item_id = runtime
            .craft_receipts
            .get("test-install")
            .expect("install receipt")
            .output_item_id;
        assert_eq!(
            runtime.item_by_id(installed_item_id).map(|item| item.zone),
            Some(CW_CARD_ZONE_INSTALLED)
        );
        assert!(!runtime
            .loose_items_at_location(location_id)
            .iter()
            .any(|item| item.id == installed_item_id));
        let pickup_fixture = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_PICK_UP_ITEM,
                actor_id: RATI_ACTOR_ID,
                item_id: installed_item_id,
                ..CwAction::default()
            },
            runtime.next_seed_value(),
        );
        assert_ne!(runtime.apply_journal_record(&pickup_fixture).0, CW_OK);
        assert_eq!(
            runtime.item_by_id(installed_item_id).map(|item| item.zone),
            Some(CW_CARD_ZONE_INSTALLED)
        );
        assert!(runtime
            .tags
            .get(&format!(
                "generated-place:{generated_location_id}:anchor-fixture"
            ))
            .is_some_and(|tag| tag.active));
        let generated = runtime
            .generated_places
            .get(&generated_location_id)
            .expect("generated place");
        assert!(runtime
            .clocks
            .get(&generated.anchor_clock_id)
            .is_some_and(|clock| clock.filled == clock.segments));
        assert_eq!(
            runtime
                .jobs
                .get(&generated.anchor_job_id)
                .map(|job| job.status.as_str()),
            Some("completed")
        );

        let snapshot = RuntimeSnapshot::from_runtime(&runtime);
        let restored = snapshot.into_runtime().expect("craft snapshot restores");
        assert_eq!(restored.craft_receipts, runtime.craft_receipts);
        assert_eq!(
            restored
                .world
                .items
                .iter()
                .take(restored.world.item_count)
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            runtime
                .world
                .items
                .iter()
                .take(runtime.world.item_count)
                .map(|item| item.id)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn craft_chain_replays_items_fixtures_provenance_and_deeds_exactly() {
        let location_id = RAIN_SOFT_GARDEN_LOCATION_ID;
        let mut committed = prepared_craft_runtime(location_id);

        let refine_record = record_for_plan(
            &committed,
            committed
                .versioned_craft_plan(RATI_ACTOR_ID, 3101, Some("replay-refine"))
                .expect("refine plan"),
        );
        assert_eq!(committed.apply_journal_record(&refine_record).0, CW_OK);
        let forge_record = record_for_plan(
            &committed,
            committed
                .versioned_craft_plan(RATI_ACTOR_ID, 3102, Some("replay-forge"))
                .expect("forge plan"),
        );
        assert_eq!(committed.apply_journal_record(&forge_record).0, CW_OK);

        let pathway = test_generated_pathway(&committed);
        let generated_location_id = pathway.waypoints[0].id;
        committed
            .generated_pathways
            .insert(pathway.id.clone(), pathway.clone());
        committed.ensure_generated_pathway_edge(
            &pathway,
            pathway.origin_location_id,
            generated_location_id,
        );
        committed.ensure_generated_place_for_waypoint(
            &pathway,
            generated_location_id,
            COSY_COTTAGE_LOCATION_ID,
        );
        committed.world.actors[..committed.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati remains present")
            .location_id = generated_location_id;
        let install_record = record_for_plan(
            &committed,
            committed
                .versioned_craft_plan(RATI_ACTOR_ID, 3103, Some("replay-install"))
                .expect("install plan"),
        );
        assert_eq!(committed.apply_journal_record(&install_record).0, CW_OK);
        assert_eq!(
            committed
                .actor_deeds(RATI_ACTOR_ID)
                .into_iter()
                .filter(|deed| deed.category == DeedCategory::Craft)
                .count(),
            3
        );

        let durable_records = [refine_record, forge_record, install_record]
            .into_iter()
            .map(|record| {
                serde_json::from_str::<JournalRecord>(
                    &serde_json::to_string(&record).expect("serialize craft journal"),
                )
                .expect("deserialize craft journal")
            })
            .collect::<Vec<_>>();
        let mut replayed = prepared_craft_runtime(location_id);
        assert_eq!(replayed.apply_journal_record(&durable_records[0]).0, CW_OK);
        assert_eq!(replayed.apply_journal_record(&durable_records[1]).0, CW_OK);
        let replay_pathway = test_generated_pathway(&replayed);
        replayed
            .generated_pathways
            .insert(replay_pathway.id.clone(), replay_pathway.clone());
        replayed.ensure_generated_pathway_edge(
            &replay_pathway,
            replay_pathway.origin_location_id,
            generated_location_id,
        );
        replayed.ensure_generated_place_for_waypoint(
            &replay_pathway,
            generated_location_id,
            COSY_COTTAGE_LOCATION_ID,
        );
        replayed.world.actors[..replayed.world.actor_count]
            .iter_mut()
            .find(|actor| actor.id == RATI_ACTOR_ID)
            .expect("Rati remains present")
            .location_id = generated_location_id;
        assert_eq!(replayed.apply_journal_record(&durable_records[2]).0, CW_OK);

        assert_eq!(
            serde_json::to_value(RuntimeSnapshot::from_runtime(&replayed))
                .expect("serialize replay snapshot"),
            serde_json::to_value(RuntimeSnapshot::from_runtime(&committed))
                .expect("serialize committed snapshot")
        );
    }
}
