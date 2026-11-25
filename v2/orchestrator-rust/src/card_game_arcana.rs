use axum::{
    extract::Path,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

fn span(page: &str, key: &str) -> Option<std::ops::Range<usize>> {
    let needle = format!(r#"{key}" content=""#);
    let start = page.find(&needle)? + needle.len();
    Some(start..start + page[start..].find('"')?)
}

fn set(page: &mut String, key: &str, value: &str) {
    if let Some(at) = span(page, key) {
        page.replace_range(at, &escape(value));
    }
}

fn cut(page: &mut String, key: &str) {
    if let Some(at) = span(page, key) {
        let start = page[..at.start].rfind('\n').map_or(0, |line| line + 1);
        let end = page[at.end..]
            .find('\n')
            .map_or(page.len(), |line| at.end + line + 1);
        page.replace_range(start..end, "");
    }
}

fn card(number: &str) -> Option<(String, String, String)> {
    let n = number
        .parse::<u64>()
        .ok()
        .filter(|n| n.to_string() == number)?;
    let read = |file| {
        let (_, bytes) = cosyworld_orchestrator::card_assets::get(file)?;
        serde_json::from_slice::<serde_json::Value>(&bytes).ok()
    };
    let deck = read("arcana.json")?;
    let card = deck["cards"]
        .as_array()?
        .iter()
        .find(|card| card["number"].as_u64() == Some(n))?;
    let art = card["art"].as_str()?;
    let image = read("image-variants.json")
        .and_then(|variants| Some(variants["images"][art]["phone"].as_str()?.to_owned()))
        .unwrap_or_else(|| art.to_owned());
    Some((
        card["name"].as_str()?.to_owned(),
        card["text"].as_str()?.to_owned(),
        image,
    ))
}

pub(super) async fn page(Path(number): Path<String>, headers: HeaderMap) -> Response {
    let (Some((name, text, image)), Some(mut page)) = (card(&number), super::table_page(&headers))
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(origin) = span(&page, "og:url").map(|at| page[at].to_owned()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let kind = if image.ends_with(".webp") {
        "image/webp"
    } else {
        "image/png"
    };
    for (key, value) in [
        ("og:title", format!("{name} · Lonely Forest")),
        ("twitter:title", format!("{name} · Lonely Forest")),
        (r#"name="description"#, text.clone()),
        ("og:description", text.clone()),
        ("twitter:description", text),
        ("og:url", format!("{origin}arcana/{number}")),
        ("og:image", format!("{origin}card-game/{image}")),
        ("twitter:image", format!("{origin}card-game/{image}")),
        ("og:image:type", kind.to_owned()),
        ("og:image:alt", name.clone()),
        ("twitter:image:alt", name),
        ("twitter:card", "summary".to_owned()),
    ] {
        set(&mut page, key, &value);
    }
    cut(&mut page, "og:image:width");
    cut(&mut page, "og:image:height");
    super::page_response(page)
}
