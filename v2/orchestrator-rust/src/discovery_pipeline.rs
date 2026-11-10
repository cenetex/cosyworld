use super::*;
use serde::ser::SerializeStruct;

pub(super) const FOCUSED_NOTICE_OFFER_KIND: &str = "focused_notice";
pub(super) const DISCOVERY_SEARCH_OFFER_KIND: &str = "search_discovery";
pub(super) const DISCOVERY_STUDY_OFFER_KIND: &str = "study_discovery";
pub(super) const DISCOVERY_SCOUT_OFFER_KIND: &str = "scout_discovery";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DiscoveryRuntimeSource {
    schema_version: u8,
    pack_id: String,
    pack_version: String,
    location_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    region_id: Option<String>,
    slot_id: String,
    catalog: DiscoveryAuthorityCatalog,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DiscoveryClaimState {
    receipt: DiscoveryRollReceipt,
    phase: String,
    revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    resolved_procedure: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    resolved_by_actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_event_seq: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct DiscoveryOfferView {
    pub(super) schema_version: u8,
    pub(super) procedure_version: String,
    pub(super) procedure: String,
    pub(super) slot_id: String,
    pub(super) slot_version: u8,
    pub(super) receipt_id: String,
    pub(super) claim_key: String,
    pub(super) phase: String,
    pub(super) target_kind: String,
    pub(super) origin_id: String,
    pub(super) turn_cost: u8,
    pub(super) resolution: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct DiscoverySceneNoticeView {
    schema_version: u8,
    slot_id: String,
    slot_version: u8,
    claim_key: String,
    target_kind: String,
    origin_id: String,
    phase: String,
    tells: Vec<DiscoveryTell>,
    resolution: String,
}

impl Serialize for DiscoverySceneNoticeView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        struct PublicTell<'a> {
            text: &'a str,
        }

        let tells = self
            .tells
            .iter()
            .map(|tell| PublicTell {
                text: tell.text.as_str(),
            })
            .collect::<Vec<_>>();
        let mut out = serializer.serialize_struct("DiscoverySceneNoticeView", 1)?;
        out.serialize_field("tells", &tells)?;
        out.end()
    }
}

impl DiscoveryRuntimeSource {}

impl RuntimeWorld {}
