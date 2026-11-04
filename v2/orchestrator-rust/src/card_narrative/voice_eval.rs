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

/// One eval scene and the lines its speakers said in it.
type Case = (String, Context, BTreeMap<String, String>);

/// The scene a speaker answers in, as `complete_selected` builds it: a Talk's
/// target hears the actor's line from this turn.
fn scene_for(context: &Context, lines: &BTreeMap<String, String>, id: &str) -> Option<Context> {
    let voiced = voiced(context);
    let (actor, target) = conversation::reply_target(context, &voiced)?;
    (target == id)
        .then(|| conversation::with_line(context, &actor, lines.get(&actor)?))
        .flatten()
}

/// The eval scenes, built by the real browser rules and request builder.
pub(super) fn cases() -> Vec<Case> {
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
            let lines = serde_json::from_value(case["lines"].clone()).unwrap_or_default();
            (name, context, lines)
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
    for (name, context, lines) in &cases {
        let mut voices = Map::new();
        for id in voiced(context) {
            let heard = scene_for(context, lines, &id);
            let context = heard.as_ref().unwrap_or(context);
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
        let (_, context, lines) = cases
            .iter()
            .find(|(name, ..)| *name == reply.case)
            .unwrap_or_else(|| panic!("missing eval case {}", reply.case));
        let heard = scene_for(context, lines, &reply.speaker);
        let context = heard.as_ref().unwrap_or(context);
        let speaker = entity(context, &reply.speaker);
        let check = Check::new(context, speaker, Part::Line);
        // What would be published: a reply that only missed its fact is
        // spoken untold, with no retry.
        let outcome = match check.clean(&reply.reply, true) {
            Ok(_) => "ok",
            Err("knowledge_fact") if check.untold(&reply.reply, true).is_ok() => "untold",
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
        "example": example(&cases),
    })
}

/// A second Talk with Pip, both turns as sent: the actor opens, then Pip
/// answers the actor's line from this turn.
fn example(cases: &[Case]) -> Value {
    let Some((_, context, lines)) = cases.iter().find(|(name, ..)| name == "station talk 4") else {
        return Value::Null;
    };
    ["vale", "moth"]
        .iter()
        .map(|id| {
            let heard = scene_for(context, lines, id);
            let context = heard.as_ref().unwrap_or(context);
            let p = conversation::messages(context, entity(context, id));
            let (system, user) = (p.assistant, p.user);
            json!({"speaker": id, "system": system, "user": user})
        })
        .collect()
}

/// The conversation cases (owner, 2026-11-02): an opener drawn from the
/// talk here, a reply to this turn's line, the group chat, and a second Talk
/// with the same person.
#[test]
fn conversation_turns_answer_one_line_with_the_talk_here() {
    let cases = cases();
    let (_, context, lines) = cases
        .iter()
        .find(|(name, ..)| name == "station talk 4")
        .unwrap();
    let action = context.action.clone().unwrap();
    // The opener: never the caption, and no cue.
    let p = conversation::messages(context, entity(context, "vale"));
    let (system, user) = (p.assistant, p.user);
    assert!(!system.contains(&action) && !user.contains(&action));
    assert!(!user.ends_with(':'));
    // The reply answers Vale's line from this turn, the second Talk with Pip.
    // An older tab's reply still reads the group chat; a current one
    // remembers through recall (P4).
    let heard = older(&scene_for(context, lines, "moth").unwrap());
    let p = conversation::messages(&heard, entity(&heard, "moth"));
    let (system, user) = (p.assistant, p.user);
    assert_eq!(
        user,
        "Vale says, \u{201c}Tell me again what the pond wants.\u{201d}"
    );
    // The group chat: earlier lines here, by both speakers, oldest first.
    let talk = system.rsplit_once("\n\n").unwrap().1;
    let vale = talk
        .find("Vale said: \"I could carry the lamp for you a while.\"")
        .unwrap();
    let pip = talk
        .find("I said: \"The lamp would help, if you trust me with it.\"")
        .unwrap();
    assert!(vale < pip);
    assert!(talk.lines().count() <= conversation::CHAT_LINES + 2);
    // Pip's own earlier line, said again, is a repeat; Vale's, parroted, too.
    let check = Check::new(&heard, entity(&heard, "moth"), Part::Line);
    assert_eq!(
        check.clean("The lamp would help, if you trust me with it.", true),
        Err("repeat")
    );
    assert_eq!(
        check.clean("Ha, you could carry the lamp for me a while.", true),
        Ok("Ha, you could carry the lamp for me a while.".into())
    );
}

/// The scene as a tab from before P3 and P4 sends it.
fn older(context: &Context) -> Context {
    let mut old: Context = serde_json::from_value(serde_json::to_value(context).unwrap()).unwrap();
    old.acting_avatar = context.acting_avatar.clone();
    for e in &mut old.entities {
        e.perception = None;
        e.recall = None;
    }
    old
}

/// A return visit (#2078), as an older tab sees it: the same pair before an incident, then after it
/// and a quiet spell. Only the second prompt carries "Between us", and it
/// never repeats what the talk here already shows.
#[test]
fn a_return_visit_remembers_what_is_between_us() {
    let cases = cases();
    let prompt = |case: &str, id: &str| {
        let (_, context, lines) = cases.iter().find(|(name, ..)| name == case).unwrap();
        let heard = scene_for(context, lines, id);
        let context = older(heard.as_ref().unwrap_or(context));
        conversation::messages(&context, entity(&context, id)).assistant
    };
    for id in ["vale", "moth"] {
        assert!(!prompt("return visit before", id).contains(" over the Lamp, "));
    }
    let vale = prompt("return visit after", "vale");
    let between = vale.split_once("\n\nPip threatened").unwrap().1;
    assert!(format!("Pip threatened{between}").starts_with(
        "Pip threatened me over the Lamp, a little while ago.\n\
         I threatened Pip over the Black cloth, some time ago.\n\
         Pip gave me this Black cloth. I'm keeping it."
    ));
    assert!(
        !vale.contains("said to me"),
        "the talk here already shows it"
    );
    // Pip sees his own newer threat first, then Vale's older one.
    let pip = prompt("return visit after", "moth");
    assert!(pip.contains(
        "\n\nI threatened Vale over the Lamp, a little while ago.\n\
         Vale threatened me over the Black cloth, some time ago."
    ));
    // The rules' third-person account is not told twice.
    for prompt in [&vale, &pip] {
        assert!(!prompt.contains(" threatens "), "{prompt}");
    }
    // At the pond the talk here is new, so the last words between them show.
    let vale = prompt("return visit pond", "vale");
    assert!(!vale.contains("Pip said: "), "{vale}");
    let between = vale.rsplit_once("\n\n").unwrap().1;
    assert!(
        between.starts_with(
            "Pip threatened me over the Lamp, some time ago.\n\
             A little while ago, Pip said to me: \"Then stay. I like company in the dark.\""
        ),
        "{between}"
    );
}

/// "In the prompting lets call them moments instead of turns" (owner,
/// 2026-11-03): no prompt these scenes build says "turn", while the table's
/// own captions keep their words.
#[test]
fn prompts_say_moments_not_turns() {
    let cases = cases();
    assert!(cases.iter().any(|(_, c, _)| c
        .action
        .as_deref()
        .is_some_and(|a| a.contains(" one turn."))));
    for (case, context, lines) in &cases {
        for id in voiced(context) {
            let heard = scene_for(context, lines, &id);
            let context = heard.as_ref().unwrap_or(context);
            let parts: &[Part] = if kind(&id, "avatar") {
                &[Part::Line, Part::Thought, Part::Persona, Part::Dream]
            } else {
                &[Part::Line]
            };
            for part in parts {
                let p = messages(context, entity(context, &id), *part);
                let (system, user) = (p.assistant, p.user);
                let text = format!("{system}\n{user}").to_lowercase();
                let turn = text
                    .split(|c: char| !c.is_alphanumeric())
                    .any(|w| w == "turn" || w == "turns");
                assert!(!turn, "{case} {id} {part:?}: {text}");
            }
        }
    }
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
    // Silent plays (Light, Put down, Take, ...) send no voice request, so
    // only the scenes that voice someone count.
    assert!(report["cases"].as_u64().unwrap() >= 20);
    assert!(report["speech"]["calls"].as_u64().unwrap() >= 30);
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
        signed: None,
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
                // The first reply speaks as an assistant; the second is speech.
                let text = if attempt == 0 {
                    "As an AI, I keep the lamp."
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
    grew(&["rejections", "assistant"], 1);
    assert!(after["prompt_tokens"]["max"].as_u64().unwrap() > 0);
    // Counters carry labels and numbers, never prompt or reply text.
    assert!(!after.to_string().contains("lamp"));
}

/// Dione wants the Funeral Oil Vale carries (.dev, 2026-11-03: "Ask Vale to
/// hand you the Funeral Oil."). Her view is her own assistant turn after
/// silence, the line she answers is the user turn, and the checks still read
/// the structured facts and the view.
#[test]
fn a_character_speaks_as_itself_in_the_assistant_turn() {
    let cases = cases();
    let (_, context, lines) = cases
        .iter()
        .find(|(name, ..)| name == "Dione wants the Funeral Oil")
        .unwrap();
    let heard = scene_for(context, lines, "greek-baker").unwrap();
    let dione = entity(&heard, "greek-baker");
    let prompt = messages(&heard, dione, Part::Line);
    assert_eq!(prompt.system, "You are Dione the Baker.");
    let view = prose(&prompt.assistant);
    assert!(view.starts_with("I am Dione the Baker.\n\nI want the Funeral Oil. "));
    assert!(view.ends_with(
        "Bread cools beneath a cloth. My hands are empty. Vale's Lamp is burning and uncovered. \
         I ask Vale for the Funeral Oil. Vale keeps it for now. Vale is holding the Funeral Oil. \
         I'm talking with Vale, the Lamplighter."
    ));
    assert!(prompt.assistant.contains("I want the Funeral Oil."));
    assert!(view.split("\n\n").all(|part| !part.contains('\n')));
    assert_eq!(
        prompt.user,
        "Vale says, \u{201c}Good evening, Dione. What are you baking?\u{201d}"
    );
    // A wrong custody claim about Vale's oil is still blocked; the view
    // read back across its facts is an echo.
    let check = Check::new(&heard, dione, Part::Line);
    assert_eq!(
        check.verdict("I'm holding the Funeral Oil.", true, false),
        Err("custody")
    );
    assert_eq!(
        check.verdict("The Funeral Oil is mine.", true, false),
        Err("custody")
    );
    let echo = "My hands are empty Vale's Lamp is burning and uncovered.";
    assert_eq!(check.verdict(echo, true, false), Err("echoed brief"));
    // Vale, with nobody heard, answers silence; who is with him is his view.
    let (_, wait, _) = cases
        .iter()
        .find(|(name, ..)| name == "Black pond wait")
        .unwrap();
    let vale = messages(wait, entity(wait, "vale"), Part::Line);
    assert_eq!(vale.user, crate::ai_gateway::SILENCE);
    assert!(vale.assistant.contains("Pip is here with me."));
}

/// P3: a line ends on what the speaker perceives now, worded from the
/// narrator's choice (L1-L4, P1-P4): no "I'm at", no roster of everyone
/// here, the listener named last, at most 70 tokens. A scene from an older
/// tab carries no perception and keeps the earlier view.
#[test]
fn a_line_ends_on_what_the_speaker_perceives() {
    let cases = cases();
    let mut views = 0;
    for (case, context, lines) in &cases {
        for id in voiced(context).into_iter().filter(|id| kind(id, "avatar")) {
            let heard = scene_for(context, lines, &id);
            let c = heard.as_ref().unwrap_or(context);
            let e = entity(c, &id);
            let Some(p) = &e.perception else { continue };
            views += 1;
            let now: Vec<_> = perception::lines(c, e, p)
                .into_iter()
                .map(|(_, l)| l)
                .collect();
            let chars: usize = now.iter().map(|l| l.chars().count() + 1).sum();
            assert!(
                chars.div_ceil(4) <= perception::TOKENS,
                "{case} {id}: {now:?}"
            );
            let view = prose(&messages(c, e, Part::Line).assistant);
            assert!(view.ends_with(&now.join(" ")), "{case} {id}: {view}");
            assert!(!view.contains("I'm at "), "{case} {id}: {view}");
        }
    }
    assert!(views >= 40, "{views}");
    let view = |case: &str, id: &str| {
        let (_, context, lines) = cases.iter().find(|(name, ..)| name == case).unwrap();
        let heard = scene_for(context, lines, id);
        let c = heard.as_ref().unwrap_or(context);
        prose(&messages(c, entity(c, id), Part::Line).assistant)
    };
    // L1: Myrto sees the flame Vale holds and the threat, not who holds what.
    let myrto = view("harbor wait with Myrto", "greek-shipmaster");
    assert!(myrto.ends_with(
        "Worn steps climb from the stone landing toward the town. My hands are empty. \
         Vale's Lamp is burning and uncovered. Pip threatens Vale over the Lamp. \
         I'm talking with Vale, the Lamplighter."
    ));
    // L4: Antigone at the gate, no "Vale and Antigone are both at…".
    let antigone = view("Antigone at the gate", "greek-antigone");
    assert!(antigone.ends_with(
        "Fresh repairs cover the gate. My hands are empty. Vale's Lamp is burning and uncovered. \
         The Gate Guard and Vale talk at last. I'm talking with Vale, the Lamplighter."
    ));
    // P2 and P4: a return compared with the visit before it.
    assert!(view("P2 back at the pond", "vale").contains("The Bell wasn't here last time I came."));
    assert!(view("P4 alone at the pond", "vale").ends_with(
        "Pip was here last time I came. A still pond beside the station. \
         I'm holding the Lamp. My Lamp is unlit and uncovered. I'm alone here."
    ));
    // An older tab sends no perception: the earlier view, unchanged.
    let (_, harbor, _) = cases
        .iter()
        .find(|(name, ..)| name == "harbor wait with Myrto")
        .unwrap();
    let mut old: Context = serde_json::from_value(serde_json::to_value(harbor).unwrap()).unwrap();
    for e in &mut old.entities {
        e.perception = None;
    }
    let myrto = prose(&messages(&old, entity(&old, "greek-shipmaster"), Part::Line).assistant);
    assert!(myrto.contains("I'm at The Wine-Dark Harbor. Vale and Pip are here with me."));
}
