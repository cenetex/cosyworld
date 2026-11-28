#![forbid(unsafe_code)]

use cosyworld_rules::{MAX_JSON_BYTES, MAX_WIRE_BYTES};
use serde_json::Value;
use wasmi::{Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

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
        self.reduce_input(&encode_request(request, None)?, FUEL)
    }

    pub fn reduce_with_pack(
        &self,
        request: &Value,
        pack_json: &str,
    ) -> Result<Option<Value>, String> {
        let fuel = match request["op"].as_str() {
            Some("create" | "validate") => RECONSTRUCTION_FUEL,
            _ => FUEL,
        };
        self.reduce_input(&encode_request(request, Some(pack_json))?, fuel)
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

fn encode_request(request: &Value, pack_json: Option<&str>) -> Result<Vec<u8>, String> {
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
        let wasm = wat::parse_str(format!(
            r#"(module
            (memory (export "memory") {memory_pages})
            (data (i32.const 64) "null")
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
        let input = encode_request(&json!({"op":"view"}), Some(pack)).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&input).unwrap(),
            json!({"op":"view", "packContentJson":pack})
        );
        let long = "x".repeat(MAX_JSON_BYTES + 1);
        assert!(encode_request(&json!({"op":"view"}), Some(&long)).is_err());
        assert!(encode_request(&json!({"op":"view", "world":long}), Some(pack)).is_err());
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
