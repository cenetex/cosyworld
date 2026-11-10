use super::*;

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
