use super::*;
use crate::card_shared::full_world::{actor_id, World};
use serde_json::json;

fn bytes(value: &Value) -> usize {
    serde_json::to_vec(value).unwrap().len()
}

fn snapshot(game: Value, version: &str) -> World {
    World {
        version: version.into(),
        game,
        claimed: [1; 8],
        present: [1; 8],
    }
}

fn cache_state() -> Value {
    let cache = views().lock().unwrap();
    json!({"entries":cache.entries.len(),"bytes":cache.bytes,
        "byte_limit":CACHE_BYTES,"entry_limit":CACHE_ENTRIES})
}

// This optional audit needs an exclusive worker. It uses the shipped reducer,
// its real cache and the actual catalog; every cold view has a distinct input.
#[test]
#[ignore = "Run in an exclusive native audit window"]
fn runtime_audit_actual_catalog_and_eight_viewers() {
    *views().lock().unwrap() = Views::default();
    let created = reduce(json!({"op":"create"})).unwrap();
    let current = snapshot(created["world"].clone(), VERSION);
    let old = reduce_version(TWENTIETH_VERSION, json!({"op":"create"})).unwrap();
    let previous = snapshot(old["world"].clone(), TWENTIETH_VERSION);
    let opening = reduce(current.request("view", 0)).unwrap();
    let action = opening["actions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "light")
        .expect("The real opening offers its lamp")
        .clone();
    let mut calls = Vec::new();
    let mut operations = Vec::new();
    for op in ["create", "validate", "view", "play", "upgrade"] {
        let mut times = Vec::new();
        let mut max_input = 0;
        let mut max_output = 0;
        let mut errors = Vec::new();
        for sample in 0..10 {
            let mut request = match op {
                "create" => json!({"op":"create"}),
                "upgrade" => {
                    let mut r = previous.request("upgrade", 0);
                    r["from"] = json!(TWENTIETH_VERSION);
                    r["to"] = json!(VERSION);
                    r
                }
                _ => current.request(op, 0),
            };
            if op == "view" {
                request["world"]["revision"] = json!(10_000 + sample);
            }
            if op == "play" {
                request["action"] = action.clone();
            }
            let input_bytes = bytes(&request);
            let hit = if op == "view" {
                let key = view_cache_key(VERSION, &request.to_string());
                views()
                    .lock()
                    .unwrap()
                    .entries
                    .iter()
                    .any(|(k, _)| *k == key)
            } else {
                false
            };
            assert!(!hit, "Every cold request must enter the interpreter");
            let started = Instant::now();
            let result = reduce(request);
            let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
            let (output_bytes, error) = match result {
                Ok(reply) => (bytes(&reply), None),
                Err(error) => (0, Some(error)),
            };
            if let Some(error) = &error {
                errors.push(error.clone());
            }
            times.push(elapsed_ms);
            max_input = max_input.max(input_bytes);
            max_output = max_output.max(output_bytes);
            calls.push(json!({"op":op,"sample":sample,"elapsed_ms":elapsed_ms,
                "input_bytes":input_bytes,"output_bytes":output_bytes,"cache_hit":hit,"error":error}));
        }
        times.sort_by(f64::total_cmp);
        let summary = json!({"op":op,"samples":times.len(),
            "p95_ms":times[(times.len()*95).div_ceil(100)-1],"max_ms":times.last(),
            "max_input_bytes":max_input,"max_output_bytes":max_output,"errors":errors});
        println!("native_catalog_operation {summary}");
        operations.push(summary);
    }

    *views().lock().unwrap() = Views::default();
    let mut viewer_calls = Vec::new();
    let mut total_first_reply_bytes = 0;
    let mut total_first_key_bytes = 0;
    let mut first_digests = Vec::new();
    for pass in 0..2 {
        for actor in 0..8 {
            let request = current.request("view", actor);
            let input_bytes = bytes(&request);
            let key = view_cache_key(VERSION, &request.to_string());
            let hit = views()
                .lock()
                .unwrap()
                .entries
                .iter()
                .any(|(k, _)| *k == key);
            let started = Instant::now();
            let result = reduce(request);
            let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
            let (output_bytes, error, digest) = match result {
                Ok(reply) => {
                    let output = serde_json::to_vec(&reply).unwrap();
                    (
                        output.len(),
                        None,
                        Some(format!("{:x}", Sha256::digest(&output))),
                    )
                }
                Err(error) => (0, Some(error), None),
            };
            let raw_cached_bytes = views()
                .lock()
                .unwrap()
                .entries
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.len());
            if pass == 0 {
                total_first_reply_bytes += raw_cached_bytes.unwrap_or(output_bytes);
                total_first_key_bytes += key.len();
                first_digests.push(digest.clone());
            } else {
                assert!(
                    hit,
                    "The second identical view stays cached for {}",
                    actor_id(actor)
                );
                assert_eq!(
                    digest,
                    first_digests[actor],
                    "Pure view for {}",
                    actor_id(actor)
                );
            }
            let row = json!({"pass":pass,"actor":actor_id(actor),"elapsed_ms":elapsed_ms,
                "input_bytes":input_bytes,"output_bytes":output_bytes,"cached_output_bytes":raw_cached_bytes,
                "key_bytes":key.len(),"cache_hit":hit,"error":error,"cache_after":cache_state()});
            println!("native_catalog_viewer {row}");
            viewer_calls.push(row);
        }
    }
    let cache_after_second_pass = cache_state();

    // Start with one cached viewer, then submit valid requests with changed
    // actor, presence and world. Each new exact input must enter C once.
    *views().lock().unwrap() = Views::default();
    let baseline = current.request("view", 0);
    reduce(baseline.clone()).unwrap();
    let mut changed_inputs = Vec::new();
    for (field, value) in [
        ("actor", json!(actor_id(1))),
        ("present", json!([actor_id(0)])),
        ("world", {
            let mut game = current.game.clone();
            game["revision"] = json!(game["revision"].as_u64().unwrap() + 1);
            game
        }),
    ] {
        let mut request = baseline.clone();
        request[field] = value;
        let key = view_cache_key(VERSION, &request.to_string());
        let hit = views()
            .lock()
            .unwrap()
            .entries
            .iter()
            .any(|(k, _)| *k == key);
        assert!(!hit, "A changed {field} input needs its own view");
        let input_bytes = bytes(&request);
        let started = Instant::now();
        let reply = reduce(request).unwrap();
        let row = json!({"field":field,"cache_hit":hit,
            "elapsed_ms":started.elapsed().as_secs_f64()*1000.0,
            "input_bytes":input_bytes,"output_bytes":bytes(&reply)});
        println!("native_changed_view_input {row}");
        changed_inputs.push(row);
    }

    // A deliberately planted cache value must never answer a command. The
    // same legal lamp action is reduced twice from the same saved world.
    let mut play_request = current.request("play", 0);
    play_request["action"] = action;
    let command_key = view_cache_key(VERSION, &play_request.to_string());
    let poison = json!({"ok":true,"audit_bypass":true}).to_string();
    views()
        .lock()
        .unwrap()
        .put(command_key.clone(), poison.clone());
    let mut command_calls = Vec::new();
    for sample in 0..2 {
        let started = Instant::now();
        let reply = reduce(play_request.clone()).unwrap();
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        assert!(reply.get("audit_bypass").is_none());
        assert_eq!(reply["world"]["items"]["lamp"]["lit"], true);
        assert!(
            reply["world"]["revision"].as_u64().unwrap()
                > current.game["revision"].as_u64().unwrap()
        );
        assert_eq!(
            views().lock().unwrap().get(&command_key),
            Some(poison.clone())
        );
        let row = json!({"sample":sample,"op":"play","planted_cache_value_ignored":true,
            "elapsed_ms":elapsed_ms,"input_bytes":bytes(&play_request),"output_bytes":bytes(&reply)});
        println!("native_command_cache_bypass {row}");
        command_calls.push(row);
    }
    let trust_bytes: usize = current.game["actors"]
        .as_object()
        .unwrap()
        .values()
        .map(|a| bytes(&a["trust"]))
        .sum();
    let keyed_trust = Value::Object(
        current.game["actors"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(id, actor)| (id.clone(), actor["trust"].clone()))
            .collect(),
    );
    let expected = std::env::var("COSYWORLD_AUDIT_EXPECTED_ACTORS")
        .ok()
        .map(|n| n.parse::<usize>().unwrap());
    let actors = current.game["actors"].as_object().unwrap().len();
    let report = json!({
        "source_commit":std::env::var("COSYWORLD_AUDIT_BASE_COMMIT").ok(),
        "rules":VERSION,"actors":actors,"items":current.game["items"].as_object().unwrap().len(),
        "fresh_shared_save_bytes":bytes(&current.game),"dense_trust_bytes":trust_bytes,
        "keyed_trust_map_bytes":bytes(&keyed_trust),
        "old_actors":previous.game["actors"].as_object().unwrap().len(),
        "limits":{"heap_bytes":96*1024*1024,"deadline_ms":2000,"save_import_bytes":2*1024*1024,
            "input_output_bytes":MAX_BYTES,"cache_bytes":CACHE_BYTES,"cache_entries":CACHE_ENTRIES},
        "operations":operations,"cold_calls":calls,"viewer_calls":viewer_calls,
        "changed_view_inputs":changed_inputs,"command_cache_bypass":command_calls,
        "eight_reply_bytes":total_first_reply_bytes,"eight_key_bytes":total_first_key_bytes,
        "eight_cache_bytes_needed":total_first_reply_bytes+total_first_key_bytes,
        "cache_after_second_pass":cache_after_second_pass,
        "bounded_cache_options":{"sixteen_mib":16*1024*1024,"twenty_four_mib":24*1024*1024,
            "forty_mib":40*1024*1024,"eight_maximum_legal_replies_and_keys":8*(MAX_BYTES+128)},
        "scope":"Actual installed catalog and fresh eight-player views; final whole-catalog, long history and reading envelopes remain separate proof"
    });
    if let Ok(path) = std::env::var("COSYWORLD_AUDIT_REPORT") {
        std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
    println!(
        "native_catalog_audit_summary {}",
        json!({
        "actors":actors,"fresh_shared_save_bytes":report["fresh_shared_save_bytes"],
        "eight_cache_bytes_needed":report["eight_cache_bytes_needed"],
        "cache_after_second_pass":report["cache_after_second_pass"]})
    );
    if let Some(expected) = expected {
        assert_eq!(actors, expected, "Audit the agreed fixed catalog");
    }
    assert!(
        operations
            .iter()
            .all(|op| op["errors"].as_array().unwrap().is_empty()),
        "Cold call errors: {operations:?}"
    );
    assert!(
        viewer_calls.iter().all(|row| row["error"].is_null()),
        "Viewer errors: {viewer_calls:?}"
    );
}
