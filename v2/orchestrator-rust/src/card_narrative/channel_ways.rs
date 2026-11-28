use serde_json::Value;

pub(super) fn routes(pack: Option<&'static Value>) -> impl Iterator<Item = &'static Value> {
    let keys: Vec<&Value> = pack
        .and_then(|p| p["continuity"]["groups"].as_array())
        .into_iter()
        .flatten()
        .map(|g| &g["key"])
        .collect();
    let gated = move |to: &str| {
        let needs = pack.and_then(|p| p["places"][to]["requires"].as_array());
        let mut needs = needs.into_iter().flatten();
        needs.any(|c| c["kind"] == "choice" && keys.contains(&&c["key"]))
    };
    let all = pack
        .and_then(|p| p["routes"].as_array())
        .into_iter()
        .flatten();
    all.filter(move |r| !gated(r["to"].as_str().unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn residents_are_told_no_way_to_a_place_on_one_branch_of_the_story() {
        let world = super::super::world("greek-drama", &[]);
        let paths = |name: &str| {
            let places = world["places"].as_array().unwrap();
            places.iter().find(|p| p["name"] == name).unwrap()["paths"].clone()
        };
        assert_eq!(
            paths("The Wine-Dark Harbor"),
            json!(["Theban Harbor Road", "The Argolid Crossroads"])
        );
        assert_eq!(paths("Proteus's Tomb in Egypt"), json!([]));
        assert_eq!(paths("Agamemnon's Tomb"), json!(["The Argolid Crossroads"]));
    }
}
