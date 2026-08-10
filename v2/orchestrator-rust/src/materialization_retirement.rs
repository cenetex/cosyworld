use super::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub(super) struct MaterializationReceiptInventory {
    pub(super) total: usize,
    pub(super) unmaterialized: usize,
    pub(super) valid_active_world_item: usize,
    pub(super) already_returned: usize,
    pub(super) duplicate: usize,
    pub(super) ambiguous: usize,
    pub(super) retained_actor_materialization: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum MaterializationReceiptClassification {
    Unmaterialized,
    ValidActiveWorldItem,
    AlreadyReturned,
    Duplicate,
    Ambiguous,
}

pub(super) fn receipt_inventory(runtime: &RuntimeWorld) -> MaterializationReceiptInventory {
    let general_receipts = runtime
        .materialization_receipts
        .values()
        .filter(|receipt| !proxim8::is_proxim8_receipt_id(&receipt.id))
        .collect::<Vec<_>>();
    let retained_actor_materialization = runtime
        .materialization_receipts
        .values()
        .filter(|receipt| proxim8::is_proxim8_receipt_id(&receipt.id))
        .count();
    let mut item_claims = BTreeMap::<u64, usize>::new();
    let mut active_card_claims = BTreeMap::<(u64, &str), usize>::new();
    for receipt in &general_receipts {
        *item_claims.entry(receipt.item_id).or_default() += 1;
        if receipt.status == "materialized" {
            *active_card_claims
                .entry((receipt.actor_id, receipt.card_id.as_str()))
                .or_default() += 1;
        }
    }

    let mut inventory = MaterializationReceiptInventory {
        total: general_receipts.len(),
        retained_actor_materialization,
        ..MaterializationReceiptInventory::default()
    };
    for receipt in general_receipts {
        match classify_receipt(runtime, receipt, &item_claims, &active_card_claims) {
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
    receipt: &MaterializationReceiptState,
    item_claims: &BTreeMap<u64, usize>,
    active_card_claims: &BTreeMap<(u64, &str), usize>,
) -> MaterializationReceiptClassification {
    if receipt.id.trim().is_empty()
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
        // Legacy receipts do not carry an owned asset-instance identifier, so
        // separate live items for the same actor/card cannot be deduplicated
        // safely without a later migration decision.
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
            "project89:proxim8:asset".to_string(),
            receipt(
                "project89:proxim8:asset",
                8000,
                "asset",
                90_006,
                "materialized",
            ),
        );
        let before_items = runtime.world.item_count;
        let before_receipts = runtime.materialization_receipts.clone();

        let inventory = receipt_inventory(&runtime);

        assert_eq!(inventory.total, 7);
        assert_eq!(inventory.valid_active_world_item, 1);
        assert_eq!(inventory.unmaterialized, 1);
        assert_eq!(inventory.already_returned, 1);
        assert_eq!(inventory.duplicate, 2);
        assert_eq!(inventory.ambiguous, 2);
        assert_eq!(inventory.retained_actor_materialization, 1);
        assert_eq!(runtime.world.item_count, before_items);
        assert_eq!(runtime.materialization_receipts, before_receipts);
    }
}
