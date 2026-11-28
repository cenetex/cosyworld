#![forbid(unsafe_code)]

use cosyworld_rules::{MAX_JSON_BYTES, MAX_WIRE_BYTES};
use serde_json::Value;
use wasmi::{Config, Engine, ExternType, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

const MAX_MODULE_BYTES: usize = 2 * 1024 * 1024;
const MEMORY_BYTES: usize = 96 * 1024 * 1024;
const FUEL: u64 = 200_000_000;
const RECONSTRUCTION_FUEL: u64 = 320_000_000;

pub struct Rules {
    engine: Engine,
    module: Module,
}

impl Rules {
    pub fn new(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_MODULE_BYTES {
            return Err("Rules Wasm artifact is too large.".into());
        }
        let mut config = Config::default();
        config.consume_fuel(true);
        let engine = Engine::new(&config);
        let module = Module::new(&engine, bytes).map_err(wasm_error)?;
        if module.imports().next().is_some() {
            return Err("Rules Wasm must have no imports.".into());
        }
        Ok(Self { engine, module })
    }

    pub fn reduce(&self, request: &Value) -> Result<Option<Value>, String> {
        self.reduce_input(&encode_request(request, None, false)?, FUEL)
    }

    pub fn reduce_with_pack(
        &self,
        request: &Value,
        pack_json: &str,
    ) -> Result<Option<Value>, String> {
        let fuel = match request["op"].as_str() {
            Some("create" | "validate" | "upgrade") => RECONSTRUCTION_FUEL,
            _ => FUEL,
        };
        let raw_pack = matches!(
            self.module.get_export("supports_raw_pack"),
            Some(ExternType::Func(_))
        );
        self.reduce_input(&encode_request(request, Some(pack_json), raw_pack)?, fuel)
    }

    fn reduce_input(&self, input: &[u8], fuel: u64) -> Result<Option<Value>, String> {
        let limits = StoreLimitsBuilder::new()
            .memory_size(MEMORY_BYTES)
            .table_elements(4096)
            .instances(1)
            .memories(1)
            .tables(1)
            .trap_on_grow_failure(true)
            .build();
        let mut store = Store::new(&self.engine, limits);
        store.limiter(|limits| limits);
        store.set_fuel(fuel).map_err(wasm_error)?;
        let instance = Linker::<StoreLimits>::new(&self.engine)
            .instantiate(&mut store, &self.module)
            .map_err(wasm_error)?
            .ensure_no_start(&mut store)
            .map_err(wasm_error)?;
        let memory = instance
            .get_memory(&store, "memory")
            .ok_or("Rules Wasm must export memory.")?;
        let reserve = instance
            .get_typed_func::<u32, u32>(&store, "reserve_input")
            .map_err(wasm_error)?;
        let reduce = instance
            .get_typed_func::<(), u32>(&store, "reduce")
            .map_err(wasm_error)?;
        let output_ptr = instance
            .get_typed_func::<(), u32>(&store, "output_ptr")
            .map_err(wasm_error)?;
        let ptr = reserve
            .call(&mut store, input.len() as u32)
            .map_err(wasm_error)? as usize;
        if ptr == 0 {
            return Err("Rules Wasm refused the request buffer.".into());
        }
        memory.write(&mut store, ptr, input).map_err(wasm_error)?;
        let len = reduce.call(&mut store, ()).map_err(wasm_error)? as usize;
        if !(1..=MAX_JSON_BYTES).contains(&len) {
            return Err("Invalid Rules Wasm response size.".into());
        }
        let ptr = output_ptr.call(&mut store, ()).map_err(wasm_error)? as usize;
        let mut output = vec![0; len];
        memory.read(&store, ptr, &mut output).map_err(wasm_error)?;
        let result: Value = serde_json::from_slice(&output).map_err(wasm_error)?;
        if result.is_null() {
            return Ok(None);
        }
        if !result["ok"].is_boolean() {
            return Err("Rules Wasm response must include an outcome.".into());
        }
        Ok(Some(result))
    }
}

fn encode_request(
    request: &Value,
    pack_json: Option<&str>,
    raw_pack: bool,
) -> Result<Vec<u8>, String> {
    let input = serde_json::to_vec(request).map_err(wasm_error)?;
    if input.len() > MAX_JSON_BYTES {
        return Err("Rules Wasm request is too large.".into());
    }
    let Some(pack_json) = pack_json else {
        return Ok(input);
    };
    if pack_json.len() > MAX_JSON_BYTES {
        return Err("Rules Wasm pack content is too large.".into());
    }
    let mut request = request
        .as_object()
        .ok_or("Rules Wasm needs a request object with pack content.")?
        .clone();
    request.remove("actorOrder");
    request.remove("placeCardOrder");
    let op = request.get("op").and_then(Value::as_str);
    let play = request
        .get("action")
        .and_then(|action| action.as_str().or_else(|| action["key"].as_str()))
        .filter(|_| op == Some("play"));
    let attic_play = matches!(
        play,
        Some("wait:vale::" | "drop:vale:lamp:attic" | "take:vale:lamp:")
    );
    let pond_play = matches!(play, Some("move:vale::pond" | "move:vale:lamp:pond"));
    let pond_speech = op == Some("speech")
        && request
            .get("world")
            .is_some_and(|world| world["actors"]["vale"]["place"] == "pond");
    let station_view = op == Some("view")
        && request
            .get("world")
            .is_some_and(|world| world["actors"]["vale"]["place"] == "station");
    let ordered = matches!(
        op,
        Some(
            "opening_wait_roster"
                | "opening_mirror_move"
                | "opening_station_move"
                | "opening_pond_ask"
                | "opening_station_residents"
                | "opening_pond_place_returns"
                | "opening_pond_resident_sleep"
                | "opening_visitor_play"
                | "opening_second_resident_round"
                | "opening_full_move"
        )
    ) || attic_play
        || pond_play
        || pond_speech
        || station_view;
    let ordered_cards = matches!(
        op,
        Some(
            "opening_place_return"
                | "opening_pond_place_returns"
                | "opening_pond_ask"
                | "opening_full_move"
        )
    ) || ((attic_play || pond_play)
        && request
            .get("world")
            .is_some_and(|world| world["began"] == 480));
    if ordered {
        if let Some(actors) = request
            .get("world")
            .and_then(|world| world["actors"].as_object())
        {
            let order = actors.keys().cloned().map(Value::String).collect();
            request.insert("actorOrder".into(), Value::Array(order));
        }
    }
    if ordered_cards {
        if let Some(cards) = request
            .get("world")
            .and_then(|world| world["placeCard"].as_object())
        {
            let order = cards.keys().cloned().map(Value::String).collect();
            request.insert("placeCardOrder".into(), Value::Array(order));
        }
    }
    if raw_pack {
        request.remove("packContentJson");
        let json = serde_json::to_vec(&request).map_err(wasm_error)?;
        if json.len() <= MAX_JSON_BYTES {
            let mut input = Vec::with_capacity(5 + json.len() + pack_json.len());
            input.push(0);
            input.extend_from_slice(&(json.len() as u32).to_le_bytes());
            input.extend_from_slice(&json);
            input.extend_from_slice(pack_json.as_bytes());
            return Ok(input);
        }
    }
    request.insert("packContentJson".into(), Value::String(pack_json.into()));
    let input = serde_json::to_vec(&request).map_err(wasm_error)?;
    if input.len() > MAX_WIRE_BYTES {
        return Err("Rules Wasm input is too large.".into());
    }
    Ok(input)
}

fn wasm_error(error: impl std::fmt::Display) -> String {
    format!("Rules Wasm: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn guest(memory_pages: u32, reducer: &str) -> Rules {
        guest_with_marker(memory_pages, reducer, "")
    }

    fn guest_with_marker(memory_pages: u32, reducer: &str, marker: &str) -> Rules {
        let wasm = wat::parse_str(format!(
            r#"(module
            (memory (export "memory") {memory_pages})
            (data (i32.const 64) "null")
            {marker}
            (func (export "reserve_input") (param i32) (result i32) i32.const 1024)
            (func (export "reduce") (result i32) {reducer})
            (func (export "output_ptr") (result i32) i32.const 64))"#
        ))
        .unwrap();
        Rules::new(&wasm).unwrap()
    }

    #[test]
    fn rejects_capability_imports() {
        let wasm =
            wat::parse_str(r#"(module (import "wasi_snapshot_preview1" "clock_time_get" (func)))"#)
                .unwrap();
        assert!(Rules::new(&wasm).is_err());
    }

    #[test]
    fn bounds_memory_and_response_size() {
        assert!(guest(1537, "i32.const 4").reduce(&json!({})).is_err());
        assert!(guest(1, "i32.const -1").reduce(&json!({})).is_err());
        assert_eq!(guest(1, "i32.const 4").reduce(&json!({})).unwrap(), None);
    }

    #[test]
    fn preserves_raw_pack_content_and_checks_request_and_pack_sizes() {
        let pack = "{\n  \"z\": \"étang\", \"a\": 1\n}\n";
        let input = encode_request(
            &json!({"op":"view","actorOrder":["vale"],"placeCardOrder":["attic"]}),
            Some(pack),
            false,
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&input).unwrap(),
            json!({"op":"view", "packContentJson":pack})
        );
        let roster = json!({"op":"opening_wait_roster", "world":{"actors":{"vale":{},"ada":{}}},"actorOrder":["vale","ada"]});
        let input = encode_request(&roster, Some(pack), false).unwrap();
        let encoded: Value = serde_json::from_slice(&input).unwrap();
        let keys: Vec<_> = roster["world"]["actors"]
            .as_object()
            .unwrap()
            .keys()
            .collect();
        assert_eq!(encoded["actorOrder"], json!(keys));
        let returns = json!({"op":"opening_place_return", "world":{"placeCard":{"z":"glass","a":"thermos"}}, "placeCardOrder":["other"]});
        let input = encode_request(&returns, Some(pack), false).unwrap();
        let encoded: Value = serde_json::from_slice(&input).unwrap();
        let keys: Vec<_> = returns["world"]["placeCard"]
            .as_object()
            .unwrap()
            .keys()
            .collect();
        assert_eq!(encoded["placeCardOrder"], json!(keys));
        let drop = json!({
            "op":"play", "action":{"key":"drop:vale:lamp:attic"},
            "world":{"began":480,"placeCard":returns["world"]["placeCard"]},
            "placeCardOrder":["other"]
        });
        let input = encode_request(&drop, Some(pack), false).unwrap();
        let encoded: Value = serde_json::from_slice(&input).unwrap();
        assert_eq!(encoded["placeCardOrder"], json!(keys));
        let long = "x".repeat(MAX_JSON_BYTES + 1);
        assert!(encode_request(&json!({"op":"view"}), Some(&long), false).is_err());
        assert!(encode_request(&json!({"op":"view", "world":long}), Some(pack), false).is_err());
    }

    #[test]
    fn sends_raw_pack_only_to_guests_with_the_marker() {
        let check = |leading| {
            format!(
            "i32.const 1024 i32.load8_u i32.const {leading} i32.eq if (result i32) i32.const 4 else i32.const 0 end"
        )
        };
        let request = json!({"op":"view"});
        let legacy = guest(1, &check(b'{'));
        assert_eq!(legacy.reduce_with_pack(&request, "{}").unwrap(), None);
        let packed = guest_with_marker(
            1,
            &check(0),
            r#"(func (export "supports_raw_pack") (result i32) i32.const 1)"#,
        );
        assert_eq!(packed.reduce_with_pack(&request, "{}").unwrap(), None);
        let pack = "{\"é\": true}";
        let input = encode_request(
            &json!({"op":"view", "packContentJson":"ignored"}),
            Some(pack),
            true,
        )
        .unwrap();
        assert_eq!(input[0], 0);
        let len = u32::from_le_bytes(input[1..5].try_into().unwrap()) as usize;
        assert_eq!(&input[5..5 + len], br#"{"op":"view"}"#);
        assert_eq!(&input[5 + len..], pack.as_bytes());
    }

    #[test]
    fn stops_a_guest_that_runs_out_of_fuel() {
        let rules = guest(1, "(loop br 0) i32.const 4");
        let error = rules.reduce(&json!({})).unwrap_err();
        assert!(error.contains("fuel"), "{error}");
        let error = rules
            .reduce_with_pack(&json!({"op":"create"}), "{}")
            .unwrap_err();
        assert!(error.contains("fuel"), "{error}");
    }
}
