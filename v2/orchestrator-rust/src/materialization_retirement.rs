use super::*;

const ITEM_MATERIALIZATION_MIGRATION_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum MaterializationReceiptClassification {
    Unmaterialized,
    ValidActiveWorldItem,
    AlreadyReturned,
    Duplicate,
    Ambiguous,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ItemMaterializationMigrationOutcome {
    PreservedOrdinaryWorldItem,
    ArchivedCollectionReturn,
    Quarantined,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct PreservedOrdinaryWorldItemState {
    pub(super) item: CwItem,
    pub(super) meta: ItemMeta,
    pub(super) provenance: ItemProvenanceState,
    pub(super) equipped_charm: bool,
    pub(super) prepared_spell: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ItemMaterializationMigrationReceipt {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) legacy_storage_key: String,
    pub(super) legacy_receipt: MaterializationReceiptState,
    pub(super) classification: MaterializationReceiptClassification,
    pub(super) outcome: ItemMaterializationMigrationOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) preserved_item: Option<PreservedOrdinaryWorldItemState>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub(super) struct MaterializationReceiptInventory {
    pub(super) total: usize,
    pub(super) unmaterialized: usize,
    pub(super) valid_active_world_item: usize,
    pub(super) already_returned: usize,
    pub(super) duplicate: usize,
    pub(super) ambiguous: usize,
    pub(super) retained_actor_materialization: usize,
    pub(super) migration_receipts: usize,
    pub(super) preserved_ordinary_world_items: usize,
    pub(super) archived_collection_returns: usize,
    pub(super) quarantined: usize,
}

pub(super) fn receipt_inventory(runtime: &RuntimeWorld) -> MaterializationReceiptInventory {
    let general_receipts = runtime
        .materialization_receipts
        .iter()
        .filter(|(storage_key, receipt)| {
            storage_key.as_str() != receipt.id
                || !proxim8::is_materialized_actor_receipt(runtime, receipt)
        })
        .collect::<Vec<_>>();
    let retained_actor_materialization = runtime
        .materialization_receipts
        .iter()
        .filter(|(storage_key, receipt)| {
            storage_key.as_str() == receipt.id
                && proxim8::is_materialized_actor_receipt(runtime, receipt)
        })
        .count();
    let mut item_claims = BTreeMap::<u64, usize>::new();
    let mut active_card_claims = BTreeMap::<(u64, &str), usize>::new();
    let mut receipt_id_claims = BTreeMap::<&str, usize>::new();
    for (_, receipt) in &general_receipts {
        *item_claims.entry(receipt.item_id).or_default() += 1;
        *receipt_id_claims.entry(receipt.id.as_str()).or_default() += 1;
        if receipt.status == "materialized" {
            *active_card_claims
                .entry((receipt.actor_id, receipt.card_id.as_str()))
                .or_default() += 1;
        }
    }

    let mut inventory = MaterializationReceiptInventory {
        total: general_receipts.len(),
        retained_actor_materialization,
        migration_receipts: runtime.item_materialization_migrations.len(),
        ..MaterializationReceiptInventory::default()
    };
    for migration in runtime.item_materialization_migrations.values() {
        match migration.outcome {
            ItemMaterializationMigrationOutcome::PreservedOrdinaryWorldItem => {
                inventory.preserved_ordinary_world_items += 1;
            }
            ItemMaterializationMigrationOutcome::ArchivedCollectionReturn => {
                inventory.archived_collection_returns += 1;
            }
            ItemMaterializationMigrationOutcome::Quarantined => inventory.quarantined += 1,
        }
    }
    for (storage_key, receipt) in general_receipts {
        match classify_receipt(
            runtime,
            storage_key,
            receipt,
            &item_claims,
            &active_card_claims,
            &receipt_id_claims,
        ) {
            MaterializationReceiptClassification::Unmaterialized => inventory.unmaterialized += 1,
            MaterializationReceiptClassification::ValidActiveWorldItem => {
                inventory.valid_active_world_item += 1;
            }
            MaterializationReceiptClassification::AlreadyReturned => {
                inventory.already_returned += 1;
            }
            MaterializationReceiptClassification::Duplicate => inventory.duplicate += 1,
            MaterializationReceiptClassification::Ambiguous => inventory.ambiguous += 1,
        }
    }
    inventory
}

fn classify_receipt(
    runtime: &RuntimeWorld,
    storage_key: &str,
    receipt: &MaterializationReceiptState,
    item_claims: &BTreeMap<u64, usize>,
    active_card_claims: &BTreeMap<(u64, &str), usize>,
    receipt_id_claims: &BTreeMap<&str, usize>,
) -> MaterializationReceiptClassification {
    if storage_key != receipt.id
        || receipt_id_claims
            .get(receipt.id.as_str())
            .copied()
            .unwrap_or_default()
            > 1
        || receipt.id.trim().is_empty()
        || receipt.actor_id == 0
        || receipt.card_id.trim().is_empty()
        || receipt.item_id == 0
        || !matches!(receipt.status.as_str(), "materialized" | "collection")
    {
        return MaterializationReceiptClassification::Ambiguous;
    }
    if item_claims
        .get(&receipt.item_id)
        .copied()
        .unwrap_or_default()
        > 1
    {
        return MaterializationReceiptClassification::Duplicate;
    }
    if receipt.status == "materialized"
        && active_card_claims
            .get(&(receipt.actor_id, receipt.card_id.as_str()))
            .copied()
            .unwrap_or_default()
            > 1
    {
        return MaterializationReceiptClassification::Ambiguous;
    }

    let item_exists = runtime.item_by_id(receipt.item_id).is_some();
    match receipt.status.as_str() {
        "collection" if !item_exists => MaterializationReceiptClassification::AlreadyReturned,
        "collection" => MaterializationReceiptClassification::Ambiguous,
        "materialized" if !item_exists => MaterializationReceiptClassification::Unmaterialized,
        "materialized" => {
            let expected_origin = format!("collection:{}", receipt.card_id);
            if runtime.items.contains_key(&receipt.item_id)
                && runtime
                    .item_provenance
                    .get(&receipt.item_id)
                    .is_some_and(|provenance| provenance.origin == expected_origin)
            {
                MaterializationReceiptClassification::ValidActiveWorldItem
            } else {
                MaterializationReceiptClassification::Ambiguous
            }
        }
        _ => MaterializationReceiptClassification::Ambiguous,
    }
}

fn migration_receipt_id(storage_key: &str) -> String {
    format!("item-materialization-migration:v1:{storage_key}")
}

fn invalid_migration_receipt(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn validate_existing_migration_receipts(runtime: &RuntimeWorld) -> io::Result<()> {
    for (storage_key, migration) in &runtime.item_materialization_migrations {
        let legacy_receipt = runtime
            .materialization_receipts
            .get(storage_key)
            .ok_or_else(|| {
                invalid_migration_receipt(format!(
                    "item migration {} has no retained legacy receipt",
                    migration.id
                ))
            })?;
        let shape_is_valid = matches!(
            (
                migration.classification,
                migration.outcome,
                migration.preserved_item.is_some(),
            ),
            (
                MaterializationReceiptClassification::ValidActiveWorldItem,
                ItemMaterializationMigrationOutcome::PreservedOrdinaryWorldItem,
                true,
            ) | (
                MaterializationReceiptClassification::AlreadyReturned,
                ItemMaterializationMigrationOutcome::ArchivedCollectionReturn,
                false,
            ) | (
                MaterializationReceiptClassification::Unmaterialized
                    | MaterializationReceiptClassification::Duplicate
                    | MaterializationReceiptClassification::Ambiguous,
                ItemMaterializationMigrationOutcome::Quarantined,
                false,
            )
        );
        let preserved_shape_is_valid = migration.preserved_item.as_ref().is_none_or(|state| {
            state.item.id == legacy_receipt.item_id
                && state.provenance.item_id == legacy_receipt.item_id
                && state.provenance.origin == format!("collection:{}", legacy_receipt.card_id)
        });
        if migration.schema_version != ITEM_MATERIALIZATION_MIGRATION_SCHEMA_VERSION
            || migration.id != migration_receipt_id(storage_key)
            || migration.legacy_storage_key != *storage_key
            || migration.legacy_receipt != *legacy_receipt
            || !shape_is_valid
            || !preserved_shape_is_valid
            || (storage_key == &legacy_receipt.id
                && proxim8::is_materialized_actor_receipt(runtime, legacy_receipt))
        {
            return Err(invalid_migration_receipt(format!(
                "item migration receipt for legacy key {storage_key} is inconsistent"
            )));
        }
    }
    Ok(())
}

pub(super) fn migrate_legacy_receipts(runtime: &mut RuntimeWorld) -> io::Result<()> {
    validate_existing_migration_receipts(runtime)?;
    let general_receipts = runtime
        .materialization_receipts
        .iter()
        .filter(|(storage_key, receipt)| {
            storage_key.as_str() != receipt.id
                || !proxim8::is_materialized_actor_receipt(runtime, receipt)
        })
        .map(|(storage_key, receipt)| (storage_key.clone(), receipt.clone()))
        .collect::<Vec<_>>();
    let mut item_claims = BTreeMap::<u64, usize>::new();
    let mut active_card_claims = BTreeMap::<(u64, String), usize>::new();
    let mut receipt_id_claims = BTreeMap::<String, usize>::new();
    for (_, receipt) in &general_receipts {
        *item_claims.entry(receipt.item_id).or_default() += 1;
        *receipt_id_claims.entry(receipt.id.clone()).or_default() += 1;
        if receipt.status == "materialized" {
            *active_card_claims
                .entry((receipt.actor_id, receipt.card_id.clone()))
                .or_default() += 1;
        }
    }
    let borrowed_active_card_claims = active_card_claims
        .iter()
        .map(|((actor_id, card_id), count)| ((*actor_id, card_id.as_str()), *count))
        .collect::<BTreeMap<_, _>>();
    let borrowed_receipt_id_claims = receipt_id_claims
        .iter()
        .map(|(id, count)| (id.as_str(), *count))
        .collect::<BTreeMap<_, _>>();

    for (storage_key, legacy_receipt) in general_receipts {
        if runtime
            .item_materialization_migrations
            .contains_key(&storage_key)
        {
            continue;
        }
        let classification = classify_receipt(
            runtime,
            &storage_key,
            &legacy_receipt,
            &item_claims,
            &borrowed_active_card_claims,
            &borrowed_receipt_id_claims,
        );
        let preserved_item =
            if classification == MaterializationReceiptClassification::ValidActiveWorldItem {
                let item = runtime
                    .item_by_id(legacy_receipt.item_id)
                    .expect("classified active materialization has a world item");
                let meta = runtime
                    .items
                    .get(&legacy_receipt.item_id)
                    .expect("classified active materialization has item metadata")
                    .clone();
                let provenance = runtime
                    .item_provenance
                    .get(&legacy_receipt.item_id)
                    .expect("classified active materialization has provenance")
                    .clone();
                let equipped_charm = runtime
                    .equipped_charms
                    .get(&item.holder_actor_id)
                    .is_some_and(|items| items.contains(&item.id));
                let prepared_spell = runtime
                    .prepared_spells
                    .get(&item.holder_actor_id)
                    .is_some_and(|items| items.contains(&item.id));
                Some(PreservedOrdinaryWorldItemState {
                    item,
                    meta,
                    provenance,
                    equipped_charm,
                    prepared_spell,
                })
            } else {
                None
            };
        let outcome = match classification {
            MaterializationReceiptClassification::ValidActiveWorldItem => {
                ItemMaterializationMigrationOutcome::PreservedOrdinaryWorldItem
            }
            MaterializationReceiptClassification::AlreadyReturned => {
                ItemMaterializationMigrationOutcome::ArchivedCollectionReturn
            }
            MaterializationReceiptClassification::Unmaterialized
            | MaterializationReceiptClassification::Duplicate
            | MaterializationReceiptClassification::Ambiguous => {
                ItemMaterializationMigrationOutcome::Quarantined
            }
        };
        runtime.item_materialization_migrations.insert(
            storage_key.clone(),
            ItemMaterializationMigrationReceipt {
                schema_version: ITEM_MATERIALIZATION_MIGRATION_SCHEMA_VERSION,
                id: migration_receipt_id(&storage_key),
                legacy_storage_key: storage_key,
                legacy_receipt,
                classification,
                outcome,
                preserved_item,
            },
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receipt(
        id: &str,
        actor_id: u64,
        card_id: &str,
        item_id: u64,
        status: &str,
    ) -> MaterializationReceiptState {
        MaterializationReceiptState {
            id: id.to_string(),
            actor_id,
            card_id: card_id.to_string(),
            item_id,
            status: status.to_string(),
            source_wallet: None,
            source_event_seq: 1,
        }
    }

    #[test]
    fn inventory_classifies_legacy_receipts_without_mutating_world_state() {
        let mut runtime = RuntimeWorld::seeded();
        let seed_meta = runtime
            .items
            .get(&2001)
            .cloned()
            .expect("seed item metadata");
        let active = receipt("legacy:active", 5000, "item-active", 90_001, "materialized");
        let active_item = CwItem {
            id: active.item_id,
            kind: CW_ITEM_KEEPSAKE,
            charges: 1,
            zone: CW_CARD_ZONE_CARRIED,
            holder_actor_id: active.actor_id,
            ..CwItem::default()
        };
        assert_eq!(
            runtime
                .materialize_item(active, active_item, seed_meta, "legacy_fixture")
                .len(),
            1
        );
        runtime.materialization_receipts.insert(
            "legacy:missing".to_string(),
            receipt(
                "legacy:missing",
                5000,
                "item-missing",
                90_002,
                "materialized",
            ),
        );
        runtime.materialization_receipts.insert(
            "legacy:returned".to_string(),
            receipt(
                "legacy:returned",
                5000,
                "item-returned",
                90_003,
                "collection",
            ),
        );
        runtime.materialization_receipts.insert(
            "legacy:duplicate-a".to_string(),
            receipt(
                "legacy:duplicate-a",
                5000,
                "item-duplicate",
                90_004,
                "materialized",
            ),
        );
        runtime.materialization_receipts.insert(
            "legacy:duplicate-b".to_string(),
            receipt(
                "legacy:duplicate-b",
                5001,
                "item-duplicate",
                90_004,
                "materialized",
            ),
        );
        runtime.materialization_receipts.insert(
            "legacy:ambiguous-a".to_string(),
            receipt(
                "legacy:ambiguous-a",
                5000,
                "item-ambiguous",
                90_005,
                "materialized",
            ),
        );
        runtime.materialization_receipts.insert(
            "legacy:ambiguous-b".to_string(),
            receipt(
                "legacy:ambiguous-b",
                5000,
                "item-ambiguous",
                90_007,
                "materialized",
            ),
        );
        runtime.materialization_receipts.insert(
            "project89:proxim8:legacy-item".to_string(),
            receipt(
                "project89:proxim8:legacy-item",
                8000,
                "legacy-item",
                90_006,
                "materialized",
            ),
        );
        let before_items = runtime.world.item_count;
        let before_receipts = runtime.materialization_receipts.clone();

        let inventory = receipt_inventory(&runtime);

        assert_eq!(inventory.total, 8);
        assert_eq!(inventory.valid_active_world_item, 1);
        assert_eq!(inventory.unmaterialized, 2);
        assert_eq!(inventory.already_returned, 1);
        assert_eq!(inventory.duplicate, 2);
        assert_eq!(inventory.ambiguous, 2);
        assert_eq!(inventory.retained_actor_materialization, 0);
        assert_eq!(runtime.world.item_count, before_items);
        assert_eq!(runtime.materialization_receipts, before_receipts);
    }

    fn materialize_fixture(
        runtime: &mut RuntimeWorld,
        id: &str,
        actor_id: u64,
        card_id: &str,
        item_id: u64,
        role: u8,
    ) {
        let receipt = receipt(id, actor_id, card_id, item_id, "materialized");
        let item = CwItem {
            id: item_id,
            kind: CW_ITEM_KEEPSAKE,
            charges: 1,
            max_charges: 1,
            weight_tenths: 1,
            size_class: CW_ITEM_SIZE_TINY,
            role,
            zone: CW_CARD_ZONE_CARRIED,
            holder_actor_id: actor_id,
            held_since_tick: runtime.world.tick,
            ..CwItem::default()
        };
        let meta = runtime
            .items
            .get(&2014)
            .cloned()
            .expect("fixture item metadata");
        assert_eq!(
            runtime
                .materialize_item(receipt, item, meta, "migration_fixture")
                .len(),
            1
        );
    }

    #[test]
    fn migration_preserves_live_item_state_quarantines_uncertainty_and_is_restart_safe() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Migration One",
        );
        create_test_human(
            &mut runtime,
            5001,
            COSY_COTTAGE_LOCATION_ID,
            "Migration Two",
        );

        materialize_fixture(
            &mut runtime,
            "legacy:copy-one",
            5000,
            "item-shared-copy",
            91_001,
            CW_ITEM_ROLE_RELIC,
        );
        materialize_fixture(
            &mut runtime,
            "legacy:copy-two",
            5001,
            "item-shared-copy",
            91_002,
            CW_ITEM_ROLE_RELIC,
        );
        materialize_fixture(
            &mut runtime,
            "legacy:equipped",
            5000,
            "item-equipped",
            91_003,
            CW_ITEM_ROLE_SKILL_CHARM,
        );
        materialize_fixture(
            &mut runtime,
            "legacy:contained",
            5001,
            "item-contained",
            91_004,
            CW_ITEM_ROLE_RELIC,
        );

        let copy_one = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == 91_001)
            .expect("first copy");
        copy_one.holder_actor_id = 5001;
        copy_one.held_since_tick = 7;
        let copy_one_provenance = runtime.item_provenance.get_mut(&91_001).unwrap();
        copy_one_provenance.previous_holder_actor_id = Some(5000);
        copy_one_provenance.current_holder_actor_id = Some(5001);
        copy_one_provenance.transfer_count = 1;
        copy_one_provenance.acquisition = "item.traded".to_string();

        let copy_two = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == 91_002)
            .expect("second copy");
        copy_two.holder_actor_id = 0;
        copy_two.location_id = COSY_COTTAGE_LOCATION_ID;
        copy_two.zone = CW_CARD_ZONE_WORLD;
        let copy_two_provenance = runtime.item_provenance.get_mut(&91_002).unwrap();
        copy_two_provenance.previous_holder_actor_id = Some(5001);
        copy_two_provenance.current_holder_actor_id = None;
        copy_two_provenance.current_location_id = Some(COSY_COTTAGE_LOCATION_ID);
        copy_two_provenance.acquisition = "item.dropped".to_string();

        let equipped = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == 91_003)
            .expect("equipped item");
        equipped.zone = CW_CARD_ZONE_EQUIPPED;
        runtime
            .equipped_charms
            .entry(5000)
            .or_default()
            .insert(91_003);

        let contained = runtime
            .world
            .items
            .iter_mut()
            .take(runtime.world.item_count)
            .find(|item| item.id == 91_004)
            .expect("contained item");
        contained.zone = CW_CARD_ZONE_CONTAINED;
        contained.container_item_id = 2002;

        runtime.materialization_receipts.insert(
            "legacy:missing".to_string(),
            receipt(
                "legacy:missing",
                5000,
                "item-missing",
                91_010,
                "materialized",
            ),
        );
        runtime.materialization_receipts.insert(
            "legacy:returned".to_string(),
            receipt(
                "legacy:returned",
                5000,
                "item-returned",
                91_011,
                "collection",
            ),
        );
        for (suffix, actor_id) in [("a", 5000), ("b", 5001)] {
            let id = format!("legacy:duplicate-{suffix}");
            runtime.materialization_receipts.insert(
                id.clone(),
                receipt(&id, actor_id, "item-duplicate", 91_012, "materialized"),
            );
        }
        for (suffix, item_id) in [("a", 91_013), ("b", 91_014)] {
            let id = format!("legacy:ambiguous-{suffix}");
            runtime.materialization_receipts.insert(
                id.clone(),
                receipt(&id, 5000, "item-ambiguous", item_id, "materialized"),
            );
        }

        let legacy_before = runtime.materialization_receipts.clone();
        let world_items_before = runtime.world.items[..runtime.world.item_count].to_vec();
        let item_meta_before = serde_json::to_value(&runtime.items).unwrap();
        let provenance_before = runtime.item_provenance.clone();
        let equipped_before = runtime.equipped_charms.clone();
        let prepared_before = runtime.prepared_spells.clone();
        let mut legacy_snapshot =
            serde_json::to_value(RuntimeSnapshot::from_runtime(&runtime)).unwrap();
        legacy_snapshot["version"] = serde_json::json!(17);
        legacy_snapshot
            .as_object_mut()
            .unwrap()
            .remove("item_materialization_migrations");

        migrate_legacy_receipts(&mut runtime).expect("first migration");

        assert_eq!(runtime.materialization_receipts, legacy_before);
        assert_eq!(
            runtime.world.items[..runtime.world.item_count],
            world_items_before
        );
        assert_eq!(
            serde_json::to_value(&runtime.items).unwrap(),
            item_meta_before
        );
        assert_eq!(runtime.item_provenance, provenance_before);
        assert_eq!(runtime.equipped_charms, equipped_before);
        assert_eq!(runtime.prepared_spells, prepared_before);

        let inventory = receipt_inventory(&runtime);
        assert_eq!(inventory.migration_receipts, 10);
        assert_eq!(inventory.preserved_ordinary_world_items, 4);
        assert_eq!(inventory.archived_collection_returns, 1);
        assert_eq!(inventory.quarantined, 5);
        let equipped_migration = runtime
            .item_materialization_migrations
            .get("legacy:equipped")
            .and_then(|migration| migration.preserved_item.as_ref())
            .expect("equipped item migration evidence");
        assert_eq!(equipped_migration.item.zone, CW_CARD_ZONE_EQUIPPED);
        assert!(equipped_migration.equipped_charm);
        let contained_migration = runtime
            .item_materialization_migrations
            .get("legacy:contained")
            .and_then(|migration| migration.preserved_item.as_ref())
            .expect("contained item migration evidence");
        assert_eq!(contained_migration.item.zone, CW_CARD_ZONE_CONTAINED);
        assert_eq!(contained_migration.item.container_item_id, 2002);

        let migrations_once =
            serde_json::to_value(&runtime.item_materialization_migrations).unwrap();
        migrate_legacy_receipts(&mut runtime).expect("repeated migration");
        assert_eq!(
            serde_json::to_value(&runtime.item_materialization_migrations).unwrap(),
            migrations_once
        );
        assert_eq!(
            runtime.world.items[..runtime.world.item_count],
            world_items_before
        );

        let restored = RuntimeSnapshot::from_runtime(&runtime)
            .into_runtime()
            .expect("migration receipts survive restart");
        assert_eq!(
            serde_json::to_value(&restored.item_materialization_migrations).unwrap(),
            migrations_once
        );
        for item_id in [91_001, 91_002, 91_003, 91_004] {
            assert_eq!(restored.item_by_id(item_id), runtime.item_by_id(item_id));
        }

        let mut upgraded = serde_json::from_value::<RuntimeSnapshot>(legacy_snapshot)
            .expect("v17 snapshot remains readable")
            .into_runtime()
            .expect("v17 snapshot restores before migration");
        assert!(upgraded.item_materialization_migrations.is_empty());
        migrate_legacy_receipts(&mut upgraded).expect("migrate v17 snapshot");
        assert_eq!(
            serde_json::to_value(&upgraded.item_materialization_migrations).unwrap(),
            migrations_once
        );
    }

    #[test]
    fn full_action_journal_replay_derives_the_same_typed_migration_receipt() {
        let path = std::env::temp_dir().join(format!(
            "cosyworld-item-migration-replay-{}-{}.sqlite",
            std::process::id(),
            now_seed()
        ));
        let _ = fs::remove_file(&path);
        let seeded = RuntimeWorld::seeded();
        let legacy_receipt = receipt(
            "legacy:journal-replay",
            RATI_ACTOR_ID,
            "item-journal-replay",
            91_100,
            "materialized",
        );
        let item = CwItem {
            id: legacy_receipt.item_id,
            kind: CW_ITEM_KEEPSAKE,
            charges: 1,
            max_charges: 1,
            weight_tenths: 1,
            size_class: CW_ITEM_SIZE_TINY,
            role: CW_ITEM_ROLE_RELIC,
            zone: CW_CARD_ZONE_CARRIED,
            holder_actor_id: RATI_ACTOR_ID,
            ..CwItem::default()
        };
        let meta = seeded.items.get(&2014).cloned().expect("fixture metadata");
        let mut record = JournalRecord::new(
            CwAction {
                kind: CW_ACTION_NONE,
                actor_id: RATI_ACTOR_ID,
                item_id: item.id,
                ..CwAction::default()
            },
            91_100,
        );
        record
            .projection_mutations
            .push(ProjectionMutation::MaterializeItem {
                receipt: legacy_receipt,
                item,
                meta,
                reason: "legacy_journal_fixture".to_string(),
            });
        append_action_journal(&path, &record).expect("append legacy materialization");

        let replayed = RuntimeWorld::from_action_journal(&path).expect("full journal replay");
        let migration = replayed
            .item_materialization_migrations
            .get("legacy:journal-replay")
            .expect("replay runs item migration");
        assert_eq!(
            migration.outcome,
            ItemMaterializationMigrationOutcome::PreservedOrdinaryWorldItem
        );
        assert_eq!(
            migration.preserved_item.as_ref().map(|state| state.item),
            replayed.item_by_id(91_100)
        );

        let mut direct = RuntimeWorld::seeded();
        assert_eq!(direct.apply_journal_record(&record).0, CW_OK);
        migrate_legacy_receipts(&mut direct).expect("direct migration");
        assert_eq!(
            serde_json::to_value(&replayed.item_materialization_migrations).unwrap(),
            serde_json::to_value(&direct.item_materialization_migrations).unwrap()
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn inconsistent_persisted_migration_receipt_fails_closed() {
        let mut runtime = RuntimeWorld::seeded();
        runtime.materialization_receipts.insert(
            "legacy:returned".to_string(),
            receipt(
                "legacy:returned",
                RATI_ACTOR_ID,
                "item-returned",
                91_200,
                "collection",
            ),
        );
        migrate_legacy_receipts(&mut runtime).expect("initial migration");
        runtime
            .item_materialization_migrations
            .get_mut("legacy:returned")
            .unwrap()
            .schema_version = 99;

        let error = migrate_legacy_receipts(&mut runtime)
            .expect_err("inconsistent migration receipt must not be trusted");
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn migrated_receipt_remains_a_stable_read_only_audit_record() {
        let mut runtime = RuntimeWorld::seeded();
        create_test_human(
            &mut runtime,
            5000,
            COSY_COTTAGE_LOCATION_ID,
            "Migrated Collection Tester",
        );
        let receipt_id = "receipt:migrated:steady-light";
        let item_id = materialized_item_id(receipt_id);
        let legacy_receipt = MaterializationReceiptState {
            id: receipt_id.to_string(),
            actor_id: 5000,
            card_id: "item-steady-light".to_string(),
            item_id,
            status: "materialized".to_string(),
            source_wallet: Some("legacy-wallet".to_string()),
            source_event_seq: runtime.world.next_event_seq,
        };
        let item = CwItem {
            id: item_id,
            kind: CW_ITEM_KEEPSAKE,
            charges: 1,
            weight_tenths: 1,
            size_class: CW_ITEM_SIZE_TINY,
            role: CW_ITEM_ROLE_SPELL,
            zone: CW_CARD_ZONE_CARRIED,
            holder_actor_id: 5000,
            ..CwItem::default()
        };
        let meta = runtime.items.get(&2014).cloned().expect("spell metadata");
        assert_eq!(
            runtime
                .materialize_item(legacy_receipt.clone(), item, meta, "migration_fixture")
                .len(),
            1
        );
        let materialized_item = runtime.item_by_id(item_id).expect("materialized item");
        migrate_legacy_receipts(&mut runtime).expect("migrate fixture receipt");
        let state = test_app_state(runtime, None);
        let (actor_session, _) = issue_actor_session(&state, 5000);
        let audit_view = state_view(
            State(state.clone()),
            Query(StateQuery {
                actor_id: Some(5000),
                actor_session: Some(actor_session.clone()),
                wallet_session: None,
                openrouter_connected: None,
            }),
        )
        .await
        .0;
        assert!(audit_view.account.linked_wallet_address.is_none());
        let runtime = state.inner.lock().await;
        assert_eq!(runtime.item_materialization_migrations.len(), 1);
        assert_eq!(
            runtime.materialization_receipts.get(receipt_id),
            Some(&legacy_receipt)
        );
        assert_eq!(runtime.item_by_id(item_id), Some(materialized_item));
    }
}
