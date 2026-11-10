use super::*;
use serde::ser::SerializeStruct;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedSpatialSceneContent {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) projection: String,
    pub(super) camera: String,
    pub(super) palette: String,
    pub(super) viewer_site_id: String,
    pub(super) sites: Vec<SeedSpatialSite>,
    pub(super) links: Vec<SeedSpatialLink>,
    #[serde(default)]
    pub(super) anchors: Vec<SeedSpatialAnchor>,
    #[serde(default)]
    pub(super) constraints: Vec<SeedSpatialConstraint>,
    #[serde(default)]
    pub(super) pack_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedSpatialSite {
    pub(super) id: String,
    pub(super) label: String,
    pub(super) kind: String,
    pub(super) tiles: Vec<[i16; 3]>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedSpatialLink {
    pub(super) from_site_id: String,
    pub(super) to_site_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedSpatialAnchor {
    pub(super) kind: String,
    pub(super) site_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) actor_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) feature_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) destination_location_id: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SeedSpatialConstraint {
    pub(super) id: String,
    pub(super) kind: String,
    pub(super) actor_id: u64,
    pub(super) destination_location_id: u64,
    pub(super) label: String,
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct SpatialSceneView {
    pub(super) schema_version: u8,
    pub(super) id: String,
    pub(super) location_id: u64,
    pub(super) definition_hash: String,
    pub(super) projection: String,
    pub(super) camera: String,
    pub(super) palette: String,
    pub(super) sites: Vec<SeedSpatialSite>,
    pub(super) links: Vec<SeedSpatialLink>,
    pub(super) tokens: Vec<SpatialTokenView>,
    pub(super) portals: Vec<SpatialPortalView>,
    pub(super) constraints: Vec<SpatialConstraintView>,
    pub(super) viewer: Option<SpatialViewerView>,
}

impl Serialize for SpatialSceneView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("SpatialSceneView", 8)?;
        out.serialize_field("schema_version", &self.schema_version)?;
        out.serialize_field("projection", &self.projection)?;
        out.serialize_field("sites", &self.sites)?;
        out.serialize_field("links", &self.links)?;
        out.serialize_field("tokens", &self.tokens)?;
        out.serialize_field("portals", &self.portals)?;
        out.serialize_field("constraints", &self.constraints)?;
        out.serialize_field("viewer", &self.viewer)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct SpatialTokenView {
    pub(super) ref_id: String,
    pub(super) kind: String,
    pub(super) actor_id: Option<u64>,
    pub(super) feature_key: Option<String>,
    pub(super) label: String,
    pub(super) site_id: String,
    pub(super) status: String,
    pub(super) hostile: bool,
    pub(super) offer_ids: Vec<String>,
}

impl Serialize for SpatialTokenView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("SpatialTokenView", 6)?;
        out.serialize_field("ref_id", &self.ref_id)?;
        out.serialize_field("kind", &self.kind)?;
        out.serialize_field("label", &self.label)?;
        out.serialize_field("site_id", &self.site_id)?;
        out.serialize_field("hostile", &self.hostile)?;
        out.serialize_field("offer_ids", &self.offer_ids)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct SpatialPortalView {
    pub(super) ref_id: String,
    pub(super) destination_location_id: u64,
    pub(super) label: String,
    pub(super) direction: Option<String>,
    pub(super) site_id: String,
    pub(super) accessible: bool,
    pub(super) locked: bool,
    pub(super) blocked: bool,
    pub(super) offer_ids: Vec<String>,
}

impl Serialize for SpatialPortalView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("SpatialPortalView", 6)?;
        out.serialize_field("ref_id", &self.ref_id)?;
        out.serialize_field("label", &self.label)?;
        out.serialize_field("direction", &self.direction)?;
        out.serialize_field("site_id", &self.site_id)?;
        out.serialize_field("blocked", &self.blocked)?;
        out.serialize_field("offer_ids", &self.offer_ids)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct SpatialConstraintView {
    pub(super) id: String,
    pub(super) kind: String,
    pub(super) subject_ref: String,
    pub(super) object_ref: String,
    pub(super) label: String,
    pub(super) active: bool,
}

impl Serialize for SpatialConstraintView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("SpatialConstraintView", 4)?;
        out.serialize_field("subject_ref", &self.subject_ref)?;
        out.serialize_field("object_ref", &self.object_ref)?;
        out.serialize_field("label", &self.label)?;
        out.serialize_field("active", &self.active)?;
        out.end()
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(super) struct SpatialViewerView {
    pub(super) actor_id: u64,
    pub(super) site_id: String,
    pub(super) placement: &'static str,
}

impl Serialize for SpatialViewerView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut out = serializer.serialize_struct("SpatialViewerView", 2)?;
        out.serialize_field("actor_id", &self.actor_id)?;
        out.serialize_field("site_id", &self.site_id)?;
        out.end()
    }
}

pub(super) fn validate_seed_spatial_scenes(content: &SeedContent) -> Result<(), String> {
    let location_by_id = content
        .locations
        .iter()
        .map(|location| (location.id, location))
        .collect::<BTreeMap<_, _>>();
    let actor_ids = content
        .actors
        .iter()
        .map(|actor| actor.id)
        .collect::<BTreeSet<_>>();
    let feature_keys = content
        .room_features
        .iter()
        .map(|feature| (feature.location_id, feature.key.as_str()))
        .collect::<BTreeSet<_>>();
    let exit_keys = content
        .exits
        .iter()
        .map(|exit| (exit.from_location_id, exit.to_location_id))
        .collect::<BTreeSet<_>>();
    let mut scene_ids = BTreeSet::new();
    let mut scene_locations = BTreeSet::new();

    for scene in &content.spatial_scenes {
        if scene.schema_version != 1
            || scene.id.trim().is_empty()
            || !scene_ids.insert(scene.id.as_str())
            || !scene_locations.insert(scene.location_id)
            || scene.projection != "isometric"
            || scene.camera.trim().is_empty()
            || scene.palette.trim().is_empty()
            || scene.sites.len() < 2
            || scene.sites.len() > 24
            || scene.links.is_empty()
            || scene.links.len() > 48
            || scene.anchors.len() > 64
            || scene.constraints.len() > 32
        {
            return Err(format!("invalid spatial scene {}", scene.id));
        }
        let Some(location) = location_by_id.get(&scene.location_id) else {
            return Err(format!(
                "spatial scene {} references unknown location {}",
                scene.id, scene.location_id
            ));
        };
        if location.interior_view != Some(InteriorViewMode::Isometric) {
            return Err(format!(
                "spatial scene {} location must use isometric interior_view",
                scene.id
            ));
        }

        let mut site_ids = BTreeSet::new();
        let mut tile_keys = BTreeSet::new();
        for site in &scene.sites {
            if site.id.trim().is_empty()
                || site.label.trim().is_empty()
                || !matches!(
                    site.kind.as_str(),
                    "entry" | "feature" | "crossing" | "exit" | "ground"
                )
                || !site_ids.insert(site.id.as_str())
                || site.tiles.is_empty()
                || site.tiles.len() > 24
            {
                return Err(format!("invalid site in spatial scene {}", scene.id));
            }
            for tile in &site.tiles {
                if tile[0].unsigned_abs() > 16
                    || tile[1].unsigned_abs() > 16
                    || !(0..=8).contains(&tile[2])
                    || !tile_keys.insert(*tile)
                {
                    return Err(format!("invalid tile in spatial scene {}", scene.id));
                }
            }
        }
        if !site_ids.contains(scene.viewer_site_id.as_str()) {
            return Err(format!("invalid viewer site in spatial scene {}", scene.id));
        }

        let mut adjacency = site_ids
            .iter()
            .map(|site_id| (*site_id, BTreeSet::new()))
            .collect::<BTreeMap<_, _>>();
        let mut link_keys = BTreeSet::new();
        for link in &scene.links {
            if link.from_site_id == link.to_site_id
                || !site_ids.contains(link.from_site_id.as_str())
                || !site_ids.contains(link.to_site_id.as_str())
            {
                return Err(format!("invalid link in spatial scene {}", scene.id));
            }
            let key = if link.from_site_id < link.to_site_id {
                (link.from_site_id.as_str(), link.to_site_id.as_str())
            } else {
                (link.to_site_id.as_str(), link.from_site_id.as_str())
            };
            if !link_keys.insert(key) {
                return Err(format!("duplicate link in spatial scene {}", scene.id));
            }
            adjacency
                .get_mut(link.from_site_id.as_str())
                .expect("validated site")
                .insert(link.to_site_id.as_str());
            adjacency
                .get_mut(link.to_site_id.as_str())
                .expect("validated site")
                .insert(link.from_site_id.as_str());
        }
        let mut pending = vec![*site_ids.iter().next().expect("scene has sites")];
        let mut visited = BTreeSet::new();
        while let Some(site_id) = pending.pop() {
            if !visited.insert(site_id) {
                continue;
            }
            pending.extend(adjacency[site_id].iter().copied());
        }
        if visited.len() != site_ids.len() {
            return Err(format!("disconnected spatial scene {}", scene.id));
        }

        let mut anchor_keys = BTreeSet::new();
        for anchor in &scene.anchors {
            if !site_ids.contains(anchor.site_id.as_str()) {
                return Err(format!("invalid anchor site in spatial scene {}", scene.id));
            }
            let identity = match anchor.kind.as_str() {
                "actor" if anchor.actor_id.is_some_and(|id| actor_ids.contains(&id)) => {
                    format!("actor:{}", anchor.actor_id.expect("checked actor"))
                }
                "feature"
                    if anchor
                        .feature_key
                        .as_deref()
                        .is_some_and(|key| feature_keys.contains(&(scene.location_id, key))) =>
                {
                    format!(
                        "feature:{}",
                        anchor.feature_key.as_deref().expect("checked feature")
                    )
                }
                "exit"
                    if anchor.destination_location_id.is_some_and(|destination| {
                        exit_keys.contains(&(scene.location_id, destination))
                    }) =>
                {
                    format!(
                        "exit:{}",
                        anchor.destination_location_id.expect("checked exit")
                    )
                }
                _ => return Err(format!("invalid anchor in spatial scene {}", scene.id)),
            };
            if !anchor_keys.insert(identity) {
                return Err(format!("duplicate anchor in spatial scene {}", scene.id));
            }
        }
        let mut constraint_ids = BTreeSet::new();
        for constraint in &scene.constraints {
            if constraint.id.trim().is_empty()
                || constraint.kind != "active_actor_blocks_exit"
                || constraint.label.trim().is_empty()
                || !constraint_ids.insert(constraint.id.as_str())
                || !anchor_keys.contains(format!("actor:{}", constraint.actor_id).as_str())
                || !anchor_keys
                    .contains(format!("exit:{}", constraint.destination_location_id).as_str())
            {
                return Err(format!("invalid constraint in spatial scene {}", scene.id));
            }
        }
    }
    Ok(())
}

impl RuntimeWorld {}
