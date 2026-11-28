use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

type Record = BTreeMap<String, Value>;
type Records = BTreeMap<String, Record>;

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Table {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub hub: Hub,
    pub packs: Vec<String>,
    pub description: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Hub {
    pub player: String,
    pub start: String,
    pub switchable: BTreeMap<String, Group>,
    pub places: Vec<String>,
    pub avatars: Vec<String>,
    pub items: Vec<String>,
    #[serde(default)]
    pub observations: Vec<Record>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Group {
    pub name: String,
    pub packs: Vec<String>,
    pub reached_by: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Pack {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub id: String,
    pub pack_id: String,
    #[schemars(range(min = 1, max = 1000000))]
    pub revision: u32,
    pub name: String,
    pub description: String,
    pub entry: String,
    pub places: BTreeMap<String, Place>,
    pub avatars: Records,
    #[serde(default)]
    pub items: Records,
    #[serde(default)]
    pub fixtures: Records,
    #[serde(default)]
    pub routes: Vec<Record>,
    #[serde(default)]
    pub choices: Vec<Record>,
    #[serde(default)]
    pub works: Vec<Record>,
    #[serde(default)]
    pub sections: Vec<Record>,
    #[serde(default)]
    pub sources: Vec<Record>,
    #[serde(default)]
    pub observations: Vec<Record>,
    #[serde(default)]
    pub story_quests: Vec<Record>,
    #[serde(default)]
    pub topics: Vec<Record>,
    #[serde(default)]
    pub kits: Vec<Record>,
    pub tone: Option<String>,
    pub coverage: Option<Record>,
    pub continuity: Option<Record>,
    pub release: Option<Release>,
    pub recital: Option<Record>,
    pub situations: Option<Record>,
    pub specials: Option<Record>,
    pub hiding: Option<Record>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Place {
    pub name: String,
    pub exits: Vec<String>,
    pub backdrop: String,
    pub text: Option<String>,
    pub persona: Option<String>,
    pub seed: Option<String>,
    pub voice: Option<String>,
    pub art: Option<String>,
    pub stage: Option<Record>,
    pub road: Option<[String; 2]>,
    pub retired: Option<bool>,
    pub sanctuary: Option<bool>,
    #[serde(default)]
    pub requires: Vec<Record>,
    #[serde(default)]
    pub backdrops: Vec<Record>,
    #[serde(default)]
    pub music: Vec<Record>,
    pub music_mode: Option<MusicMode>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum MusicMode {
    Sequence,
    RandomPerVisit,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Release {
    pub places: Vec<String>,
    pub avatars: Vec<String>,
    pub items: Vec<String>,
    pub choices: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Bridge {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub id: String,
    pub pack: String,
    pub description: String,
    pub entries: Vec<Entry>,
    pub crossings: Vec<Crossing>,
    #[serde(default)]
    pub values: Records,
    #[serde(default)]
    pub transports: BTreeMap<String, Transport>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Transport {
    pub place: String,
    pub docks: Vec<String>,
    pub at: String,
    pub lanes: Vec<Lane>,
    pub shipmaster: Option<String>,
    pub wait_verb: Option<String>,
    pub wait_sentence: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Lane {
    pub from: String,
    pub to: String,
    pub one_way: Option<bool>,
    pub opens_with: Option<Vec<Record>>,
    pub spends: Option<Value>,
    pub sealed: Option<bool>,
    pub empty_recall: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct Entry {
    pub joins: String,
    pub at: String,
    pub arrive: String,
    pub via: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Crossing {
    pub id: String,
    pub from: String,
    pub to: String,
    pub travelers: Travelers,
    pub travel: String,
    pub requires: Vec<Record>,
    pub signal: Option<Record>,
    pub unlock_when: Option<Vec<Record>>,
    pub unlock_method: Option<String>,
    pub scenery: Option<Record>,
    pub opened: Option<String>,
    pub closed: Option<String>,
    pub travel_label: Option<String>,
    pub transport: Option<String>,
    #[serde(default)]
    pub retired: bool,
    pub sealed: Option<Record>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Travelers {
    Player,
    Any,
}
