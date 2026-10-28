use super::*;

fn page() -> Context {
    serde_json::from_str(include_str!(
        "../../../../test/fixtures/card-heard-page-context.json"
    ))
    .unwrap()
}

#[test]
fn accepts_exact_heard_pages_and_keeps_reader_and_authors_separate() {
    let context = page();
    assert!(valid(&context));
    for id in ["vale", "greek-viii-aeschylus", "greek-viii-euripides"] {
        let entity = entity(&context, id);
        assert!(recital::valid(id, entity.poem.as_ref(), context.turn));
        let prompt = transcript(&context, entity, Part::Line);
        assert!(prompt.contains("Heard page 1"));
        assert!(prompt.contains("Vale read this frozen account"));
        assert!(!prompt.contains("My earned poem"));
    }
    let poet = entity(&context, "greek-viii-aeschylus");
    assert!(!recital::valid("ash", poet.poem.as_ref(), context.turn));
}

#[test]
fn rejects_changed_page_words_authors_turns_and_catalogs() {
    let original = serde_json::to_value(page()).unwrap();
    let poet = original["entities"]
        .as_array()
        .unwrap()
        .iter()
        .position(|e| e["id"] == "greek-viii-aeschylus")
        .unwrap();
    for (pointer, value) in [
        (
            format!("/entities/{poet}/poem/stanzas/0/lines/0"),
            json!("A changed line."),
        ),
        (
            format!("/entities/{poet}/poem/stanzas/0/authorName"),
            json!("Aeschylus"),
        ),
        (format!("/entities/{poet}/poem/heard/through"), json!(1)),
        (
            format!("/entities/{poet}/poem/heard/catalogDigest"),
            json!("0".repeat(64)),
        ),
        (format!("/entities/{poet}/poem/heard/pageCount"), json!(128)),
        (
            format!("/entities/{poet}/poem/heard/audience/0"),
            json!("ash"),
        ),
    ] {
        let mut changed = original.clone();
        *changed.pointer_mut(&pointer).unwrap() = value;
        let context: Context = serde_json::from_value(changed).unwrap();
        assert!(!valid(&context), "Reject {pointer}");
    }
}

#[test]
fn keeps_private_couplets_out_of_every_outsider_prompt_and_generated_line() {
    let heard = page();
    let poet = entity(&heard, "greek-viii-aeschylus");
    let stanza = &poet.poem.as_ref().unwrap().stanzas[0];
    let outsider: Context = serde_json::from_str(include_str!(
        "../../../../test/fixtures/card-unheard-page-context.json"
    ))
    .unwrap();
    assert!(valid(&outsider));
    for entity in &outsider.entities {
        for part in [Part::Line, Part::Thought, Part::Persona, Part::Dream] {
            let prompt = transcript(&outsider, entity, part);
            assert!(!prompt.contains(&stanza.lines[0]));
            assert!(!prompt.contains(&stanza.lines[1]));
        }
    }
    let poet = entity(&outsider, "greek-viii-aeschylus");
    let text = stanza.lines.join(" ");
    assert!(!heard::quote_allowed(&text, &outsider, poet));
    assert!(Check::new(&outsider, poet, Part::Line)
        .clean(&text, true)
        .is_err());
    assert_eq!(
        reflection_due(&heard, entity(&heard, "greek-viii-aeschylus")),
        (false, false)
    );
}
