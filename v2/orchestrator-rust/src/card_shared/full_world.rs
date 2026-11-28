use super::{
    cast, content, engine,
    seat_guard::{SeatAction, Session},
    store::Result,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(super) struct World {
    pub version: String,
    pub game: Value,
    pub claimed: [i32; 8],
    pub present: [i32; 8],
    // The pack content revision is omitted from older saved bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack: Option<String>,
}
pub(super) fn actor_id(a: usize) -> &'static str {
    cast()["avatars"][a]["id"].as_str().expect("cast ID")
}
pub(super) fn actor_index(id: &str) -> Result<usize> {
    (0..8)
        .find(|a| actor_id(*a) == id)
        .ok_or_else(|| "Choose one of the eight avatars.".into())
}
pub(super) fn run_seed(id: &str) -> u32 {
    let d = Sha256::digest(id.as_bytes());
    u32::from_be_bytes([d[0], d[1], d[2], d[3]])
}
impl World {
    #[cfg(test)]
    pub fn create(save: Option<&str>) -> Result<Self> {
        Self::seeded(save, None)
    }
    #[cfg(test)]
    pub fn seeded(save: Option<&str>, seed: Option<u32>) -> Result<Self> {
        Self::hiding(save, seed, &Value::Null)
    }
    pub fn hiding(save: Option<&str>, seed: Option<u32>, hide: &Value) -> Result<Self> {
        let mut request = json!({"op":"create","save":save});
        if let Some(seed) = seed {
            request["seed"] = json!(seed);
        }
        for key in ["hidden", "absent", "homecoming"] {
            if !hide[key].is_null() {
                request[key] = hide[key].clone();
            }
        }
        let result = engine::reduce(request)?;
        Ok(Self {
            version: engine::version().into(),
            game: result["world"].clone(),
            claimed: [0; 8],
            present: [0; 8],
            pack: Some(content::current().into()),
        })
    }
    pub fn room(&self, a: usize) -> Result<&str> {
        self.game["actors"][actor_id(a)]["place"]
            .as_str()
            .ok_or_else(|| "The avatar's place needs attention.".into())
    }
    pub fn request(&self, op: &str, a: usize) -> Value {
        json!({"op":op,"world":self.game,"actor":actor_id(a),
          "claimed":(0..8).filter(|i|self.claimed[*i]==1).map(actor_id).collect::<Vec<_>>(),
          "present":(0..8).filter(|i|self.present[*i]==1).map(actor_id).collect::<Vec<_>>()})
    }
    fn session(&self) -> Result<Session<'_>> {
        let mut rooms = [""; 8];
        for (a, slot) in rooms.iter_mut().enumerate() {
            let room = self.room(a)?;
            if room.is_empty() || room.len() >= 128 || room.as_bytes().contains(&0) {
                return Err("The place ID needs attention.".into());
            }
            *slot = room;
        }
        Ok(Session {
            claimed: &self.claimed,
            present: &self.present,
            rooms,
        })
    }
    fn guard(&self, next: &Self, action: SeatAction, a: usize) -> Result<()> {
        self.session()?
            .guard(&next.session()?, action, a)
            .map_err(str::to_owned)
    }
    // Journal commands use versioned rules and the same seat guard.
    pub fn apply(&mut self, command: &Value) -> Result<Value> {
        self.apply_with(command, &mut engine::reduce_journal)
    }

    pub(super) fn apply_with(
        &mut self,
        command: &Value,
        reduce: &mut impl FnMut(&str, Option<&str>, Value) -> Result<Value>,
    ) -> Result<Value> {
        if engine::newer(&self.version) {
            return Err(engine::UPDATING.into());
        }
        if command["op"] == "repack" {
            return self.repack(command, reduce);
        }
        if command["op"] == "upgrade" {
            let target = command["to"]
                .as_str()
                .ok_or("Choose a saved rules upgrade.")?;
            let versions: Vec<_> = engine::versions().collect();
            let allowed = versions
                .iter()
                .position(|v| *v == self.version)
                .zip(versions.iter().position(|v| *v == target))
                .is_some_and(|(from, to)| from < to);
            if engine::newer(target) {
                return Err(engine::UPDATING.into());
            }
            if command["from"] != self.version || !allowed {
                return Err("This world's rules upgrade needs its original version.".into());
            }
            let mut request = self.request("upgrade", 0);
            request["from"] = json!(self.version);
            request["to"] = json!(target);
            if command["seed"].is_u64() {
                request["seed"] = command["seed"].clone();
            }
            let pack = Some(
                command["pack"]
                    .as_str()
                    .ok_or("Choose the upgrade's pack content.")?,
            );
            // Recorded upgrades retain their released target transformation.
            let result = reduce(target, pack, request)?;
            self.game = result["world"].clone();
            self.version = target.into();
            self.pack = pack.map(String::from);
            return Ok(result);
        }
        if !engine::versions().any(|version| version == self.version) {
            return Err("This world's rules need a saved migration.".into());
        }
        let a = actor_index(command["actor"].as_str().ok_or("Choose an avatar.")?)?;
        let op = command["op"].as_str().ok_or("Choose an action.")?;
        let mut next = self.clone();
        let (kind, result) = match op {
            "claim" => {
                let mut request = self.request("join_state", a);
                if !command["progress"].is_null() {
                    request["progress"] = command["progress"].clone();
                }
                let result = reduce(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                next.claimed[a] = 1;
                (SeatAction::Claim, result)
            }
            "release" => {
                next.claimed[a] = 0;
                next.present[a] = 0;
                (SeatAction::Release, json!({}))
            }
            // The owner's delete: the avatar starts over (#1825). Rules that
            // predate it refuse the request, so it is never journaled for them.
            "reset" => {
                let result = reduce(
                    &self.version,
                    self.pack.as_deref(),
                    self.request("reset", a),
                )?;
                next.game = result["world"].clone();
                next.claimed[a] = 0;
                next.present[a] = 0;
                (SeatAction::Reset, result)
            }
            "enter" => {
                next.present[a] = 1;
                (SeatAction::Enter, json!({}))
            }
            "leave" => {
                next.present[a] = 0;
                (SeatAction::Leave, json!({}))
            }
            "hold" => {
                let mut request = self.request("hold", a);
                request["choice"] = command["choice"].clone();
                let result = reduce(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                (SeatAction::Play, result)
            }
            "play" => {
                let mut request = self.request("play", a);
                request["action"] = command["action"].clone();
                if let Some(portraits) = command.get("elysiumPortraits") {
                    request["elysiumPortraits"] = portraits.clone();
                }
                let result = reduce(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                (SeatAction::Play, result)
            }
            // "+ Find Mara": the quest to talk to the hidden avatar (#1936).
            "seek" => {
                let result = reduce(&self.version, self.pack.as_deref(), self.request("seek", a))?;
                next.game = result["world"].clone();
                (SeatAction::Play, result)
            }
            "speech" => {
                let mut request = self.request("speech", a);
                request["lines"] = command["lines"].clone();
                request["room"] = command["room"].clone();
                request["entries"] = command["entries"].clone();
                request["disclosures"] = command["disclosures"].clone();
                let result = reduce(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                self.guard(&next, SeatAction::Text, a)?;
                *self = next;
                return Ok(result);
            }
            // A reflection can arrive after its speaker leaves (#2016).
            "reflect" => {
                let mut request = self.request("reflect", a);
                for key in ["turn", "resting", "rest", "entries"] {
                    request[key] = command[key].clone();
                }
                let result = reduce(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                self.guard(&next, SeatAction::Text, a)?;
                *self = next;
                return Ok(result);
            }
            _ => return Err("Choose an available play.".into()),
        };
        // Station admission is journaled with presence, not with a later GET.
        if matches!(op, "enter" | "leave" | "release" | "reset") {
            let settled = reduce(
                &next.version,
                next.pack.as_deref(),
                next.request("presence", a),
            )?;
            next.game = settled["world"].clone();
        }
        self.guard(&next, kind, a)?;
        *self = next;
        Ok(result)
    }
    // Move the world onto another pack content revision under the same rules.
    fn repack(
        &mut self,
        command: &Value,
        reduce: &mut impl FnMut(&str, Option<&str>, Value) -> Result<Value>,
    ) -> Result<Value> {
        let to = command["to"]
            .as_str()
            .ok_or("Choose a pack content revision.")?;
        if command["from"].as_str() != self.pack.as_deref() || self.pack.as_deref() == Some(to) {
            return Err("This world's pack change needs its original revision.".into());
        }
        let mut request = self.request("upgrade", 0);
        request["from"] = json!(self.version);
        request["to"] = json!(self.version);
        let result = reduce(&self.version, Some(to), request)?;
        self.game = result["world"].clone();
        self.pack = Some(to.into());
        Ok(result)
    }
    pub fn project(&self, a: usize) -> Result<Value> {
        let mut view =
            engine::reduce_pack(&self.version, self.pack.as_deref(), self.request("view", a))?;
        if let Some(memories) = view["world"]["memories"].as_object_mut() {
            for (id, memory) in memories {
                if id != actor_id(a) {
                    if let Some(memory) = memory.as_object_mut() {
                        for key in [
                            "innerLife",
                            "reflections",
                            "learning",
                            "seen",
                            "text",
                            "model",
                        ] {
                            memory.remove(key);
                        }
                        for key in ["events", "landmarks"] {
                            if memory.contains_key(key) {
                                memory.insert(key.into(), json!([]));
                            }
                        }
                    }
                }
            }
        }
        Ok(view)
    }
}
