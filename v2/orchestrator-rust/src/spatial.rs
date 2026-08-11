use super::*;
use sha2::{Digest, Sha256};

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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub(super) struct SpatialTokenView {
    pub(super) ref_id: String,
    pub(super) kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) actor_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) feature_key: Option<String>,
    pub(super) label: String,
    pub(super) site_id: String,
    pub(super) status: String,
    pub(super) hostile: bool,
    pub(super) offer_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub(super) struct SpatialConstraintView {
    pub(super) id: String,
    pub(super) kind: String,
    pub(super) subject_ref: String,
    pub(super) object_ref: String,
    pub(super) label: String,
    pub(super) active: bool,
}

#[derive(Debug, Serialize)]
pub(super) struct SpatialViewerView {
    pub(super) actor_id: u64,
    pub(super) site_id: String,
    pub(super) placement: &'static str,
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

fn offer_ids_for_actor(actor_id: u64, offers: &[RankedActionOffer]) -> Vec<String> {
    offers
        .iter()
        .filter(|offer| {
            offer
                .target
                .as_ref()
                .is_some_and(|target| target.kind == "actor" && target.id == Some(actor_id))
        })
        .map(|offer| offer.offer_id.clone())
        .collect()
}

fn offer_ids_for_feature(
    location_id: u64,
    feature_key: &str,
    feature_name: &str,
    offers: &[RankedActionOffer],
) -> Vec<String> {
    let suffix = format!(":{location_id}:{feature_key}");
    offers
        .iter()
        .filter(|offer| {
            offer.id.ends_with(&suffix)
                || offer.target.as_ref().is_some_and(|target| {
                    target.kind == "feature"
                        && target.id == Some(location_id)
                        && target.label.as_deref() == Some(feature_name)
                })
        })
        .map(|offer| offer.offer_id.clone())
        .collect()
}

fn offer_ids_for_exit(destination_location_id: u64, offers: &[RankedActionOffer]) -> Vec<String> {
    offers
        .iter()
        .filter(|offer| {
            offer.target.as_ref().is_some_and(|target| {
                target.kind == "location" && target.id == Some(destination_location_id)
            })
        })
        .map(|offer| offer.offer_id.clone())
        .collect()
}

impl RuntimeWorld {
    pub(super) fn spatial_scene_view(
        &self,
        viewer_actor_id: Option<u64>,
        location_id: u64,
        actors: &[ActorView],
        exits: &[ExitView],
        offers: &[RankedActionOffer],
        access: &AccessContext,
    ) -> Option<SpatialSceneView> {
        let scene = active_content()
            .spatial_scenes
            .iter()
            .find(|scene| scene.location_id == location_id)?;
        let active_blockers = scene
            .constraints
            .iter()
            .filter(|constraint| {
                actors
                    .iter()
                    .any(|actor| actor.id == constraint.actor_id && actor.status == "active")
            })
            .map(|constraint| constraint.actor_id)
            .collect::<BTreeSet<_>>();

        let actor_site = |actor_id| {
            scene
                .anchors
                .iter()
                .find(|anchor| anchor.kind == "actor" && anchor.actor_id == Some(actor_id))
                .map(|anchor| anchor.site_id.clone())
                .unwrap_or_else(|| scene.viewer_site_id.clone())
        };
        let mut tokens = actors
            .iter()
            .map(|actor| SpatialTokenView {
                ref_id: format!("actor:{}", actor.id),
                kind: "actor".to_string(),
                actor_id: Some(actor.id),
                feature_key: None,
                label: actor.name.clone(),
                site_id: actor_site(actor.id),
                status: actor.status.clone(),
                hostile: active_blockers.contains(&actor.id),
                offer_ids: offer_ids_for_actor(actor.id, offers),
            })
            .collect::<Vec<_>>();
        for anchor in scene
            .anchors
            .iter()
            .filter(|anchor| anchor.kind == "feature")
        {
            let feature_key = anchor.feature_key.as_deref()?;
            let feature = active_content()
                .room_features
                .iter()
                .find(|feature| feature.location_id == location_id && feature.key == feature_key)?;
            tokens.push(SpatialTokenView {
                ref_id: format!("feature:{feature_key}"),
                kind: "feature".to_string(),
                actor_id: None,
                feature_key: Some(feature_key.to_string()),
                label: feature.name.clone(),
                site_id: anchor.site_id.clone(),
                status: "present".to_string(),
                hostile: false,
                offer_ids: offer_ids_for_feature(location_id, feature_key, &feature.name, offers),
            });
        }

        let mut portals = Vec::new();
        for anchor in scene.anchors.iter().filter(|anchor| anchor.kind == "exit") {
            let destination_location_id = anchor.destination_location_id?;
            let projected_exit = exits
                .iter()
                .find(|exit| exit.destination_location_id == destination_location_id);
            let seed_exit = self.world.exits[..self.world.exit_count]
                .iter()
                .find(|exit| {
                    exit.from_location_id == location_id
                        && exit.to_location_id == destination_location_id
                })?;
            let threshold = viewer_actor_id.and_then(|actor_id| {
                self.threshold_offer_binding_for_exit_with_access(
                    actor_id,
                    location_id,
                    destination_location_id,
                    access,
                )
            });
            let locked = projected_exit.map(|exit| exit.locked).unwrap_or_else(|| {
                threshold
                    .as_ref()
                    .map(|(_, allowed)| !allowed)
                    .unwrap_or(seed_exit.flags & CW_EXIT_LOCKED != 0)
            });
            let accessible = projected_exit
                .map(|exit| exit.accessible)
                .unwrap_or_else(|| location_access_allowed(destination_location_id, access));
            portals.push(SpatialPortalView {
                ref_id: format!("exit:{destination_location_id}"),
                destination_location_id,
                label: projected_exit
                    .map(|exit| exit.destination_location_name.clone())
                    .or_else(|| self.location_name(destination_location_id))
                    .unwrap_or_else(|| format!("Location {destination_location_id}")),
                direction: projected_exit
                    .and_then(|exit| exit.direction.clone())
                    .or_else(|| self.exit_direction(location_id, destination_location_id)),
                site_id: anchor.site_id.clone(),
                accessible,
                locked,
                blocked: scene.constraints.iter().any(|constraint| {
                    constraint.destination_location_id == destination_location_id
                        && active_blockers.contains(&constraint.actor_id)
                }),
                offer_ids: offer_ids_for_exit(destination_location_id, offers),
            });
        }
        let constraints = scene
            .constraints
            .iter()
            .map(|constraint| SpatialConstraintView {
                id: constraint.id.clone(),
                kind: constraint.kind.clone(),
                subject_ref: format!("actor:{}", constraint.actor_id),
                object_ref: format!("exit:{}", constraint.destination_location_id),
                label: constraint.label.clone(),
                active: active_blockers.contains(&constraint.actor_id),
            })
            .collect();
        let mut digest = Sha256::new();
        digest.update(serde_json::to_vec(scene).unwrap_or_default());
        Some(SpatialSceneView {
            schema_version: scene.schema_version,
            id: scene.id.clone(),
            location_id,
            definition_hash: format!("sha256:{:x}", digest.finalize()),
            projection: scene.projection.clone(),
            camera: scene.camera.clone(),
            palette: scene.palette.clone(),
            sites: scene.sites.clone(),
            links: scene.links.clone(),
            tokens,
            portals,
            constraints,
            viewer: viewer_actor_id.map(|actor_id| SpatialViewerView {
                actor_id,
                site_id: actor_site(actor_id),
                placement: "presentation_only",
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_schema_round_trips_without_runtime_coordinates() {
        let scene = SeedSpatialSceneContent {
            schema_version: 1,
            id: "test:scene:1".to_string(),
            location_id: 1,
            projection: "isometric".to_string(),
            camera: "north_east".to_string(),
            palette: "moor".to_string(),
            viewer_site_id: "entry".to_string(),
            sites: vec![
                SeedSpatialSite {
                    id: "entry".to_string(),
                    label: "Entry".to_string(),
                    kind: "entry".to_string(),
                    tiles: vec![[0, 0, 0]],
                },
                SeedSpatialSite {
                    id: "gate".to_string(),
                    label: "Gate".to_string(),
                    kind: "exit".to_string(),
                    tiles: vec![[1, 0, 0]],
                },
            ],
            links: vec![SeedSpatialLink {
                from_site_id: "entry".to_string(),
                to_site_id: "gate".to_string(),
            }],
            anchors: Vec::new(),
            constraints: Vec::new(),
            pack_id: "test.pack".to_string(),
        };
        let value = serde_json::to_value(scene).expect("scene serializes");
        assert_eq!(value["projection"], "isometric");
        assert_eq!(value["sites"][0]["tiles"][0], serde_json::json!([0, 0, 0]));
        assert!(value.get("actor_position").is_none());
    }

    #[test]
    fn empty_visible_hand_has_no_spatial_highlights() {
        let offers = Vec::<RankedActionOffer>::new();
        assert!(offer_ids_for_actor(10, &offers).is_empty());
        assert!(offer_ids_for_feature(1, "flame", "Flame", &offers).is_empty());
        assert!(offer_ids_for_exit(2, &offers).is_empty());
    }
}
