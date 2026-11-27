use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::OnceLock};

const RINGS: [&str; 3] = [
    "elysium-ring-outer",
    "elysium-ring-middle",
    "elysium-ring-inner",
];

#[derive(Deserialize)]
struct Settings {
    models: Vec<String>,
    settings: BTreeMap<String, String>,
}

struct Catalog {
    models: Vec<String>,
    rooms: Vec<Template>,
}

pub(super) struct Template {
    pub(super) address: [u16; 3],
    pub(super) room: String,
    pub(super) setting: String,
    pub(super) resident: String,
}

fn catalog() -> &'static Catalog {
    static LOADED: OnceLock<Catalog> = OnceLock::new();
    LOADED.get_or_init(|| {
        let assets = cosyworld_orchestrator::card_assets::text;
        let data: Settings =
            serde_json::from_str(assets("card-game/elysium-coordinate-models.json"))
                .expect("Elysium coordinate models");
        let packs: Value =
            serde_json::from_str(assets("card-game/packs.json")).expect("card packs");
        let pack = packs["packs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pack| pack["id"] == "elysium")
            .expect("Elysium pack");
        let rooms = pack["routes"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|route| {
                let requirements = route["requires"].as_array()?;
                let place_for = |ring: &str| {
                    requirements
                        .iter()
                        .find(|r| r["kind"] == "item_at" && r["item"] == ring)?["place"]
                        .as_str()
                };
                let number_for = |ring| {
                    place_for(ring)?
                        .strip_prefix("elysium-void-")?
                        .parse::<u16>()
                        .ok()
                        .filter(|number| *number <= 999)
                };
                let address = [
                    number_for(RINGS[0])?,
                    number_for(RINGS[1])?,
                    number_for(RINGS[2])?,
                ];
                let room = route["to"].as_str()?.to_owned();
                let number = room.strip_prefix("elysium-void-")?;
                Some(Template {
                    address,
                    resident: format!("elysium-coordinate-{number}"),
                    setting: data
                        .settings
                        .get(&room)
                        .cloned()
                        .expect("coordinate room setting"),
                    room,
                })
            })
            .collect();
        Catalog {
            models: data.models,
            rooms,
        }
    })
}

pub(super) fn template(id: &str) -> Option<&'static Template> {
    if !id.starts_with("elysium-coordinate-") {
        return None;
    }
    catalog().rooms.iter().find(|room| room.resident == id)
}

pub(crate) fn is_resident(id: &str) -> bool {
    template(id).is_some()
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Coordinate {
    address: [u16; 3],
    room: String,
    resident: String,
    model: String,
    scope: String,
}

impl Coordinate {
    pub(crate) fn resident(&self) -> &str {
        &self.resident
    }

    pub(super) fn template(&self) -> Option<&'static Template> {
        template(&self.resident)
            .filter(|room| room.room == self.room && room.address == self.address)
    }

    pub(crate) fn model(&self) -> Option<&'static str> {
        let [a, b, c] = self.address;
        let input = format!("{}:elysium-coordinate:{a},{b},{c}", self.scope);
        let hash = input.bytes().fold(2_166_136_261_u32, |hash, byte| {
            (hash ^ u32::from(byte)).wrapping_mul(16_777_619)
        });
        let models = &catalog().models;
        let pinned = models.get(hash as usize % models.len().max(1))?.as_str();
        (pinned == self.model).then_some(pinned)
    }

    pub(crate) fn valid_at(&self, room: &str) -> bool {
        room == self.room
            && self
                .scope
                .parse::<u32>()
                .is_ok_and(|seed| seed.to_string() == self.scope)
            && self.template().is_some()
            && self.model().is_some()
    }

    pub(crate) fn setting(&self) -> Option<&'static str> {
        self.template().map(|room| room.setting.as_str())
    }

    pub(super) fn name_key(&self, shared_world: Option<&str>) -> String {
        key(shared_world, &self.scope, self.address)
    }

    /// The existing signed line and name keep their shape. A local name can only
    /// join dialogue in the same saved run, ordered room address and model binding.
    pub(crate) fn proof_marker(&self) -> String {
        let proof = serde_json::json!([self.scope, self.address, self.resident, self.model]);
        format!("/coordinate/{:x}", Sha256::digest(proof.to_string()))
    }
}

pub(super) fn key(shared_world: Option<&str>, scope: &str, address: [u16; 3]) -> String {
    let binding = match shared_world {
        Some(world) => serde_json::json!(["shared", world, address]),
        None => serde_json::json!(["local", scope, address]),
    };
    format!("{:x}", Sha256::digest(binding.to_string()))
}

pub(super) fn talk_target(work: &serde_json::Value, actor: &str) -> Option<String> {
    let coordinate: Coordinate =
        serde_json::from_value(work["context"]["elysiumCoordinate"].clone()).ok()?;
    let room = work["room"].as_str()?;
    (coordinate.valid_at(room)
        && work["events"].as_array()?.iter().any(|event| {
            event["kind"] == "action"
                && event["verb"] == "talk"
                && event["generated"] != true
                && event["actorId"] == actor
                && event["locationId"] == room
                && event["fromLocationId"] == room
                && event["targetId"] == coordinate.resident
        }))
    .then_some(coordinate.resident)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinate_scope_and_order_are_authoritative() {
        let input = serde_json::json!({"address":[5,3,8],"room":"elysium-void-013",
            "resident":"elysium-coordinate-013","model":"deepseek/deepseek-v4.1-flash","scope":"17"});
        let coordinate: Coordinate = serde_json::from_value(input.clone()).unwrap();
        assert!(coordinate.valid_at("elysium-void-013"));
        assert!(!coordinate.valid_at("elysium-void-021"));
        let mut wrong = input.clone();
        wrong["address"] = serde_json::json!([5, 8, 3]);
        assert!(!serde_json::from_value::<Coordinate>(wrong)
            .unwrap()
            .valid_at("elysium-void-013"));
        let mut wrong = input;
        wrong["model"] = serde_json::json!("unapproved/model");
        assert!(!serde_json::from_value::<Coordinate>(wrong)
            .unwrap()
            .valid_at("elysium-void-013"));
        let first = coordinate.name_key(Some("world-one"));
        assert_ne!(first, coordinate.name_key(Some("world-two")));
        assert_ne!(first, coordinate.name_key(None));
        assert_ne!(first, key(Some("world-one"), "17", [5, 8, 3]));
    }
}
