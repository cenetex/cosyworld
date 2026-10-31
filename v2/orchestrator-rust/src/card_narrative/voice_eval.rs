//! Offline voice-context eval (#1537). It builds every voice prompt for the
//! narrative-contract scenes and a scripted conversation, reports approximate
//! tokens by section, and replays recorded replies through the validator.
//!
//! `false_claim` is not a validator reason yet. This eval carries its own
//! detector so a baseline exists before the Weltgeist frame adds one.
//!
//! `npm run v2:voice:eval` prints the report; set COSYWORLD_VOICE_EVAL_OUT to
//! also write it as JSON.
use super::voice_metrics::{Budget, Section};
use super::*;
use serde_json::Map;

/// The eval scenes, built by the real browser rules and request builder.
pub(super) fn cases() -> Vec<(String, Context)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let output = std::process::Command::new("node")
        .current_dir(root)
        .args([
            "--input-type=module",
            "-e",
            "import { voiceEvalCases } from './test/fixtures/card-voice-eval-cases.mjs'; console.log(JSON.stringify(voiceEvalCases()));",
        ])
        .output()
        .expect("Node 24 builds the voice eval scenes");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let cases: Vec<Value> = serde_json::from_slice(&output.stdout).unwrap();
    cases
        .into_iter()
        .map(|case| {
            let name = case["name"].as_str().unwrap().to_string();
            let context: Context = serde_json::from_value(case["context"].clone())
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(valid(&context), "{name}: invalid context");
            (name, context)
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Recorded {
    case: String,
    speaker: String,
    reply: String,
    /// The validator's reason, or "ok".
    expect: String,
    #[serde(default)]
    false_claim: bool,
}

fn recorded() -> Vec<Recorded> {
    serde_json::from_str(include_str!(
        "../../../../test/fixtures/card-voice-replies.json"
    ))
    .expect("recorded voice replies")
}

/// Item names as a speaker would say them, by id.
fn item_names() -> Vec<(String, String)> {
    profiles()
        .as_object()
        .unwrap()
        .iter()
        .filter(|(_, p)| p["kind"] == "item")
        .filter_map(|(id, p)| {
            let name = p["name"].as_str()?.to_lowercase();
            let name = name.strip_prefix("the ").unwrap_or(&name).to_string();
            Some((id.clone(), name))
        })
        .collect()
}

/// First-person possessions and deeds the frame does not support. A claim
/// to hold an item needs the resolved holder (or the speaker's own Holding
/// fact); a claim to have given, taken, lit, rung or covered an item needs a
/// committed event or memory naming the speaker with that item.
pub(super) fn false_claims(context: &Context, speaker: &str, text: &str) -> Vec<String> {
    const HOLD: &[&str] = &[
        "i have ",
        "i've got ",
        "i hold ",
        "i'm holding ",
        "i am holding ",
        "i carry ",
        "i'm carrying ",
    ];
    // Each claimed deed with the present and past forms a record uses.
    const DEED: &[(&str, &[&str])] = &[
        ("i gave ", &["gives", "gave"]),
        ("i took ", &["takes", "took"]),
        ("i lit ", &["lights", "lit"]),
        ("i rang ", &["rings", "rang"]),
        ("i covered ", &["covers", "covered"]),
        ("i found ", &["finds", "found"]),
        ("i brought ", &["brings", "brought"]),
    ];
    let entity = entity(context, speaker);
    let own = name(speaker).to_lowercase();
    let holds = |item: &str, label: &str| match &context.outcome {
        Some(outcome) => outcome
            .avatars
            .iter()
            .any(|a| a.id == speaker && a.holding.iter().any(|h| h == item)),
        None => entity.facts.iter().any(|f| {
            let f = f.to_lowercase();
            f.starts_with("holding") && f.contains(label)
        }),
    };
    let record: Vec<String> = context
        .action
        .iter()
        .chain(context.events.iter())
        .chain(entity.memories.iter().map(|m| &m.text))
        .chain(entity.facts.iter())
        .map(|t| t.to_lowercase())
        .collect();
    let did = |label: &str, forms: &[&str]| {
        record.iter().any(|t| {
            t.contains(label)
                && forms.iter().any(|form| {
                    t.contains(&format!("{own} {form}")) || t.contains(&format!("i {form}"))
                })
        })
    };
    let mut claims = Vec::new();
    for sentence in text.split_inclusive(['.', '!', '?', ';']) {
        if sentence.trim_end().ends_with('?') {
            continue;
        }
        let s = format!(" {}", sentence.to_lowercase().replace('\u{2019}', "'"));
        for (id, label) in item_names() {
            let deeds = DEED.iter().map(|(verb, forms)| (*verb, Some(*forms)));
            for (verb, forms) in HOLD.iter().map(|verb| (*verb, None)).chain(deeds) {
                let claimed = [
                    "", "the ", "my ", "your ", "a ", "an ", "you the ", "him the ", "her the ",
                ]
                .iter()
                .any(|det| s.contains(&format!(" {verb}{det}{label}")));
                let supported = match forms {
                    None => holds(&id, &label),
                    Some(forms) => did(&label, forms),
                };
                if claimed && !supported {
                    claims.push(format!("{verb}{label}"));
                }
            }
        }
    }
    claims
}

fn percentile(sorted: &[u64], p: usize) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    sorted[(sorted.len() - 1) * p / 100]
}

/// The whole eval as JSON: prompt sizes and the recorded-reply tallies.
pub(super) fn report() -> Value {
    let cases = cases();
    let mut by_section: BTreeMap<&str, u64> = BTreeMap::new();
    let mut speech: Vec<u64> = Vec::new();
    let mut speech_sections: BTreeMap<&str, u64> = BTreeMap::new();
    let mut all: Vec<u64> = Vec::new();
    // The scripted conversation, where table history accumulates.
    let mut talk: Vec<u64> = Vec::new();
    let mut talk_sections: BTreeMap<&str, u64> = BTreeMap::new();
    let mut per_case = Vec::new();
    for (name, context) in &cases {
        let mut voices = Map::new();
        for id in voiced(context) {
            let entity = entity(context, &id);
            let budget =
                Budget::measure(&idiolect(entity, Part::Line), context, entity, Part::Line);
            all.push(budget.total());
            for section in Section::ALL {
                *by_section.entry(section.label()).or_default() += budget.get(section);
            }
            if kind(&id, "avatar") {
                speech.push(budget.total());
                for section in Section::ALL {
                    *speech_sections.entry(section.label()).or_default() += budget.get(section);
                }
            }
            if kind(&id, "avatar") && name.starts_with("station talk") {
                talk.push(budget.total());
                for section in Section::ALL {
                    *talk_sections.entry(section.label()).or_default() += budget.get(section);
                }
            }
            voices.insert(id, json!(budget.total()));
        }
        per_case.push(json!({"case": name, "tokens": voices}));
    }
    let mean = |sums: &BTreeMap<&str, u64>, n: usize| -> Value {
        sums.iter()
            .map(|(k, v)| ((*k).to_string(), json!(v / n.max(1) as u64)))
            .collect::<Map<_, _>>()
            .into()
    };
    let stats = |values: &mut Vec<u64>| {
        values.sort_unstable();
        json!({
            "calls": values.len(),
            "mean": values.iter().sum::<u64>() / values.len().max(1) as u64,
            "p50": percentile(values, 50),
            "p95": percentile(values, 95),
            "max": values.last().copied().unwrap_or(0),
        })
    };
    let mut reasons: BTreeMap<String, u64> = BTreeMap::new();
    let mut false_claim_count = 0;
    let mut mismatches = Vec::new();
    let replies = recorded();
    for reply in &replies {
        let (_, context) = cases
            .iter()
            .find(|(name, _)| *name == reply.case)
            .unwrap_or_else(|| panic!("missing eval case {}", reply.case));
        let speaker = entity(context, &reply.speaker);
        let check = Check::new(context, speaker, Part::Line);
        let outcome = match check.clean(&reply.reply, true) {
            Ok(_) => "ok",
            Err(reason) => reason,
        };
        *reasons.entry(outcome.to_string()).or_default() += 1;
        let claims = false_claims(context, &reply.speaker, &reply.reply);
        if !claims.is_empty() {
            false_claim_count += 1;
        }
        if outcome != reply.expect || claims.is_empty() == reply.false_claim {
            mismatches.push(json!({"reply": reply.reply, "got": outcome, "claims": claims}));
        }
    }
    json!({
        "approximate_tokens": "ceil(chars / 4) per section",
        "cases": cases.len(),
        "all_voices": stats(&mut all),
        "all_voices_mean_by_section": mean(&by_section, all.len()),
        "speech": stats(&mut speech),
        "speech_mean_by_section": mean(&speech_sections, speech.len()),
        "conversation_speech": stats(&mut talk),
        "conversation_speech_mean_by_section": mean(&talk_sections, talk.len()),
        "replies": {
            "recorded": replies.len(),
            "by_reason": reasons,
            "false_claims": false_claim_count,
            "mismatches": mismatches,
        },
        "per_case": per_case,
    })
}

#[test]
fn voice_eval_measures_contract_prompts_and_recorded_replies() {
    let report = report();
    if let Ok(path) = std::env::var("COSYWORLD_VOICE_EVAL_OUT") {
        std::fs::write(&path, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    }
    println!(
        "voice eval: {} cases; speech {}; speech by section {}; conversation speech {}; by section {}; replies {}",
        report["cases"],
        report["speech"],
        report["speech_mean_by_section"],
        report["conversation_speech"],
        report["conversation_speech_mean_by_section"],
        json!({
            "by_reason": report["replies"]["by_reason"],
            "false_claims": report["replies"]["false_claims"],
        })
    );
    assert!(report["cases"].as_u64().unwrap() >= 30);
    assert!(report["speech"]["calls"].as_u64().unwrap() >= 60);
    // Every prompt stays inside a small model's context.
    assert!(report["all_voices"]["max"].as_u64().unwrap() <= 1_100);
    assert_eq!(
        report["replies"]["mismatches"],
        json!([]),
        "recorded replies changed outcome"
    );
}

#[test]
fn false_claim_detector_reads_the_resolved_frame() {
    let mut c = super::tests::context();
    c.entities[0].memories.push(Memory {
        seq: None,
        turn: 2,
        kind: "event".into(),
        text: "Vale lit the lamp.".into(),
    });
    c.outcome = Some(serde_json::from_value(json!({
        "card":{"kind":"talk","target":"moth","item":null,"receive":null,"destination":null,"accepted":null},
        "avatars":[
            {"id":"vale","location":"station","holding":["lamp"],"travel":null},
            {"id":"moth","location":"station","holding":["cloth"],"travel":null}
        ],
        "items":[
            {"id":"lamp","holder":"vale","location":"station"},
            {"id":"cloth","holder":"moth","location":"station"}
        ]
    })).unwrap());
    assert!(false_claims(&c, "vale", "I have the lamp right here.").is_empty());
    assert_eq!(
        false_claims(&c, "vale", "I have the black cloth, so stay close."),
        vec!["i have black cloth".to_string()]
    );
    // A question claims nothing; a recorded deed is supported.
    assert!(false_claims(&c, "vale", "Do I have the black cloth?").is_empty());
    assert!(false_claims(&c, "vale", "I lit the lamp myself.").is_empty());
    assert_eq!(false_claims(&c, "moth", "I gave you the lamp.").len(), 1);
}

#[tokio::test]
async fn each_voice_call_counts_its_attempts_reasons_and_tokens() {
    let tries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = tries.clone();
    let provider = Router::new().route(
        "/chat/completions",
        post(move |Json(body): Json<Value>| {
            let attempt = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async move {
                // The first reply copies the play; the second is fresh speech.
                let text = if attempt == 0 {
                    "Vale asks Pip what they want."
                } else {
                    "I keep the lamp close and listen."
                };
                Json(json!({"model":body["model"],"choices":[{"message":{"content":text},"finish_reason":"stop"}]}))
            }
        }),
    );
    let (address, server) = super::tests::serve(provider).await;
    let before = super::voice_metrics::snapshot();
    let c = super::tests::context();
    let result = complete_selected(
        &super::tests::test_config(address),
        &c,
        &BTreeMap::new(),
        &VoiceSettings::hosted(),
        &["vale".into()],
        false,
        None,
    )
    .await
    .unwrap();
    server.abort();
    assert_eq!(
        result["entries"][0]["text"],
        "I keep the lamp close and listen."
    );
    let after = super::voice_metrics::snapshot();
    let grew = |path: &[&str], by: u64| {
        let read = |v: &Value| path.iter().fold(v, |v, k| &v[*k]).as_u64().unwrap_or(0);
        assert!(
            read(&after) >= read(&before) + by,
            "{path:?}: {before} -> {after}"
        );
    };
    grew(&["calls"], 1);
    grew(&["attempts"], 2);
    grew(&["outcomes", "spoken"], 1);
    grew(&["rejections", "repeat"], 1);
    assert!(after["prompt_tokens"]["max"].as_u64().unwrap() > 0);
    // Counters carry labels and numbers, never prompt or reply text.
    assert!(!after.to_string().contains("lamp"));
}
