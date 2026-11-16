use super::{cast, content, engine, store::Result};
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
    // The pack content revision read by rules that take content as input.
    // Absent for older rules, so their saved bytes stay the same.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pack: Option<String>,
}
#[repr(C)]
struct Session {
    claimed: [i32; 8],
    present: [i32; 8],
    rooms: [[u8; 128]; 8],
}
extern "C" {
    fn ct_shared_guard(before: *const Session, after: *const Session, kind: i32, actor: i32)
        -> i32;
}
pub(super) fn actor_id(a: usize) -> &'static str {
    cast()["avatars"][a]["id"].as_str().expect("cast ID")
}
pub(super) fn actor_index(id: &str) -> Result<usize> {
    (0..8)
        .find(|a| actor_id(*a) == id)
        .ok_or_else(|| "Choose one of the eight avatars.".into())
}
// A shared world's run seed: the first four bytes of the SHA-256 of its ID.
// Rules that draw specials read it from create, migrate and upgrade.
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
    // A new world's hidden and absent avatars, and its creator's homecoming.
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
            version: engine::VERSION.into(),
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
    fn session(&self) -> Result<Session> {
        let mut s = Session {
            claimed: self.claimed,
            present: self.present,
            rooms: [[0; 128]; 8],
        };
        for (a, slot) in s.rooms.iter_mut().enumerate() {
            let room = self.room(a)?;
            if room.is_empty() || room.len() >= 128 || room.bytes().any(|b| b == 0) {
                return Err("The place ID needs attention.".into());
            }
            slot[..room.len()].copy_from_slice(room.as_bytes());
        }
        Ok(s)
    }
    fn guard(&self, next: &Self, kind: i32, a: usize) -> Result<()> {
        let code = unsafe { ct_shared_guard(&self.session()?, &next.session()?, kind, a as i32) };
        match code {
            0 => Ok(()),
            2 => Err("That avatar has just been claimed.".into()),
            3 => Err("Enter the room before playing.".into()),
            4 => Err("The room filled just now. Wait for a place.".into()),
            _ => Err("Choose an available play.".into()),
        }
    }
    // Every journal command is reduced through the same C guard and C-hosted
    // authored rules. AI text is appended by the authored speech reducer.
    pub fn apply(&mut self, command: &Value) -> Result<Value> {
        if engine::newer(&self.version) {
            return Err(engine::UPDATING.into());
        }
        if command["op"] == "repack" {
            return self.repack(command);
        }
        if command["op"] == "upgrade" {
            let target = command["to"]
                .as_str()
                .ok_or("Choose a saved rules upgrade.")?;
            let versions = [
                engine::HUNDRED_THIRTY_THIRD_VERSION,
                engine::HUNDRED_THIRTY_FOURTH_VERSION,
                engine::HUNDRED_THIRTY_FIFTH_VERSION,
                engine::HUNDRED_THIRTY_SIXTH_VERSION,
                engine::HUNDRED_THIRTY_SEVENTH_VERSION,
                engine::HUNDRED_THIRTY_EIGHTH_VERSION,
                engine::HUNDRED_THIRTY_NINTH_VERSION,
                engine::HUNDRED_FORTIETH_VERSION,
                engine::HUNDRED_FORTY_FIRST_VERSION,
                engine::HUNDRED_FORTY_SECOND_VERSION,
                engine::HUNDRED_FORTY_THIRD_VERSION,
                engine::HUNDRED_FORTY_FOURTH_VERSION,
                engine::HUNDRED_FORTY_FIFTH_VERSION,
                engine::HUNDRED_FORTY_SIXTH_VERSION,
                engine::HUNDRED_FORTY_SEVENTH_VERSION,
                engine::HUNDRED_FORTY_EIGHTH_VERSION,
                engine::HUNDRED_FORTY_NINTH_VERSION,
                engine::HUNDRED_FIFTIETH_VERSION,
                engine::HUNDRED_FIFTY_FIRST_VERSION,
                engine::HUNDRED_FIFTY_SECOND_VERSION,
                engine::HUNDRED_FIFTY_THIRD_VERSION,
                engine::HUNDRED_FIFTY_FOURTH_VERSION,
                engine::HUNDRED_FIFTY_FIFTH_VERSION,
                engine::HUNDRED_FIFTY_SIXTH_VERSION,
                engine::HUNDRED_FIFTY_SEVENTH_VERSION,
                engine::VERSION,
            ];
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
            // Earlier rules ignore the seed; older records carry none.
            if command["seed"].is_u64() {
                request["seed"] = command["seed"].clone();
            }
            let pack = Some(
                command["pack"]
                    .as_str()
                    .ok_or("Choose the upgrade's pack content.")?,
            );
            // Recorded upgrades retain their released target transformation.
            let result = engine::reduce_pack(target, pack, request)?;
            self.game = result["world"].clone();
            self.version = target.into();
            self.pack = pack.map(String::from);
            return Ok(result);
        }
        if ![
            engine::VERSION,
            engine::HUNDRED_THIRTY_THIRD_VERSION,
            engine::HUNDRED_THIRTY_FOURTH_VERSION,
            engine::HUNDRED_THIRTY_FIFTH_VERSION,
            engine::HUNDRED_THIRTY_SIXTH_VERSION,
            engine::HUNDRED_THIRTY_SEVENTH_VERSION,
            engine::HUNDRED_THIRTY_EIGHTH_VERSION,
            engine::HUNDRED_THIRTY_NINTH_VERSION,
            engine::HUNDRED_FORTIETH_VERSION,
            engine::HUNDRED_FORTY_FIRST_VERSION,
            engine::HUNDRED_FORTY_SECOND_VERSION,
            engine::HUNDRED_FORTY_THIRD_VERSION,
            engine::HUNDRED_FORTY_FOURTH_VERSION,
            engine::HUNDRED_FORTY_FIFTH_VERSION,
            engine::HUNDRED_FORTY_SIXTH_VERSION,
            engine::HUNDRED_FORTY_SEVENTH_VERSION,
            engine::HUNDRED_FORTY_EIGHTH_VERSION,
            engine::HUNDRED_FORTY_NINTH_VERSION,
            engine::HUNDRED_FIFTIETH_VERSION,
            engine::HUNDRED_FIFTY_FIRST_VERSION,
            engine::HUNDRED_FIFTY_SECOND_VERSION,
            engine::HUNDRED_FIFTY_THIRD_VERSION,
            engine::HUNDRED_FIFTY_FOURTH_VERSION,
            engine::HUNDRED_FIFTY_FIFTH_VERSION,
            engine::HUNDRED_FIFTY_SIXTH_VERSION,
            engine::HUNDRED_FIFTY_SEVENTH_VERSION,
        ]
        .contains(&self.version.as_str())
        {
            return Err("This world's rules need a saved migration.".into());
        }
        let a = actor_index(command["actor"].as_str().ok_or("Choose an avatar.")?)?;
        let op = command["op"].as_str().ok_or("Choose an action.")?;
        let mut next = self.clone();
        let (kind, result) = match op {
            "claim" => {
                // The avatar's level travels with it from its last seat (#1846).
                let mut request = self.request("join", a);
                if !command["progress"].is_null() {
                    request["progress"] = command["progress"].clone();
                }
                let result = engine::reduce_pack(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                next.claimed[a] = 1;
                (1, result)
            }
            "release" => {
                next.claimed[a] = 0;
                next.present[a] = 0;
                (2, json!({}))
            }
            // The owner's delete: the avatar starts over (#1825). Rules that
            // predate it refuse the request, so it is never journaled for them.
            "reset" => {
                let result = engine::reduce_pack(
                    &self.version,
                    self.pack.as_deref(),
                    self.request("reset", a),
                )?;
                next.game = result["world"].clone();
                next.claimed[a] = 0;
                next.present[a] = 0;
                (13, result)
            }
            "enter" => {
                next.present[a] = 1;
                (3, json!({}))
            }
            "leave" => {
                next.present[a] = 0;
                (4, json!({}))
            }
            "hold" => {
                let mut request = self.request("hold", a);
                request["choice"] = command["choice"].clone();
                let result = engine::reduce_pack(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                (11, result)
            }
            "play" => {
                let mut request = self.request("play", a);
                request["action"] = command["action"].clone();
                let result = engine::reduce_pack(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                (11, result)
            }
            // "+ Find Mara": the quest to talk to the hidden avatar (#1936).
            "seek" => {
                let result = engine::reduce_pack(
                    &self.version,
                    self.pack.as_deref(),
                    self.request("seek", a),
                )?;
                next.game = result["world"].clone();
                (11, result)
            }
            "speech" => {
                let mut request = self.request("speech", a);
                request["lines"] = command["lines"].clone();
                request["room"] = command["room"].clone();
                request["entries"] = command["entries"].clone();
                request["disclosures"] = command["disclosures"].clone();
                let result = engine::reduce_pack(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                // Committed text can finish after its speaker disconnects.
                self.guard(&next, 12, a)?;
                *self = next;
                return Ok(result);
            }
            // Reflections journaled after their speech (#2016). Like speech,
            // they move no one and may land after the speaker leaves.
            "reflect" => {
                let mut request = self.request("reflect", a);
                for key in ["turn", "resting", "rest", "entries"] {
                    request[key] = command[key].clone();
                }
                let result = engine::reduce_pack(&self.version, self.pack.as_deref(), request)?;
                next.game = result["world"].clone();
                self.guard(&next, 12, a)?;
                *self = next;
                return Ok(result);
            }
            _ => return Err("Choose an available play.".into()),
        };
        // Station admission is journaled with presence, not with a later GET.
        if matches!(op, "enter" | "leave" | "release" | "reset") {
            let settled = engine::reduce_pack(
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
    fn repack(&mut self, command: &Value) -> Result<Value> {
        let to = command["to"]
            .as_str()
            .ok_or("Choose a pack content revision.")?;
        if command["from"].as_str() != self.pack.as_deref() || self.pack.as_deref() == Some(to) {
            return Err("This world's pack change needs its original revision.".into());
        }
        let mut request = self.request("upgrade", 0);
        request["from"] = json!(self.version);
        request["to"] = json!(self.version);
        let result = engine::reduce_pack(&self.version, Some(to), request)?;
        self.game = result["world"].clone();
        self.pack = Some(to.into());
        Ok(result)
    }
    pub fn project(&self, a: usize) -> Result<Value> {
        let mut view =
            engine::reduce_pack(&self.version, self.pack.as_deref(), self.request("view", a))?;
        // Apply privacy to every released interpreter, including older saves.
        // The browser reads only its own avatar's memory, so every other
        // memory leaves as an empty record. This keeps each view a fraction
        // of the world's size; the journal and the stored world keep all.
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
