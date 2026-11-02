//! Public source map for the card game and the classic compatibility fields.

use serde::Serialize;

pub(crate) fn primary() -> bool {
    std::env::var("COSYWORLD_PRIMARY_GAME").as_deref() == Ok("cards")
}

#[derive(Debug, Serialize)]
pub(crate) struct GameMetadata {
    primary_game: &'static str,
    card_game: CardGameMetadata,
    metadata_scopes: MetadataScopes,
}

#[derive(Debug, Serialize)]
struct CardGameMetadata {
    entry_url: &'static str,
    source_root: &'static str,
    play_modes: [&'static str; 2],
    shared_rules_version: &'static str,
    assets_sha256: &'static str,
    catalogs: Catalogs,
}

#[derive(Debug, Serialize)]
struct Catalogs {
    forest: &'static str,
    shared_avatars: &'static str,
    character_profiles: &'static str,
    mounted_packs: &'static str,
}

#[derive(Debug, Serialize)]
struct MetadataScopes {
    worldpack: &'static str,
    world: &'static str,
    combat: &'static str,
    content_engine_version: &'static str,
}

impl GameMetadata {
    pub(crate) fn current() -> Self {
        Self::for_primary(primary())
    }

    pub(crate) fn for_primary(cards: bool) -> Self {
        Self {
            primary_game: if cards { "card-table" } else { "classic" },
            card_game: CardGameMetadata {
                entry_url: if cards { "/" } else { "/card-game/" },
                source_root: "v2/card-game/",
                play_modes: ["local", "shared"],
                shared_rules_version: crate::card_shared::RULES_VERSION,
                assets_sha256: cosyworld_orchestrator::card_assets::manifest_sha256(),
                catalogs: Catalogs {
                    forest: "/card-game/forest.json",
                    shared_avatars: "/card-game/shared-cast.json",
                    character_profiles: "/card-game/entity-profiles.json",
                    mounted_packs: "/card-game/packs.json",
                },
            },
            metadata_scopes: MetadataScopes {
                worldpack: "classic-compatibility",
                world: "classic-compatibility",
                combat: "classic-compatibility",
                content_engine_version: "classic-compatibility",
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn metadata_selects_the_served_game_and_published_catalogs() {
        for cards in [false, true] {
            let meta = serde_json::to_value(GameMetadata::for_primary(cards)).unwrap();
            assert_eq!(
                meta["primary_game"],
                if cards { "card-table" } else { "classic" }
            );
            assert_eq!(
                meta["card_game"]["shared_rules_version"],
                crate::card_shared::RULES_VERSION
            );
            assert_eq!(
                meta["metadata_scopes"]["worldpack"],
                "classic-compatibility"
            );
            assert_eq!(meta["metadata_scopes"]["world"], "classic-compatibility");
            let router = super::super::router::<()>();
            let entry = meta["card_game"]["entry_url"].as_str().unwrap();
            let response = router
                .clone()
                .oneshot(Request::builder().uri(entry).body(Body::empty()).unwrap())
                .await
                .unwrap();
            let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            assert_eq!(&bytes[..], include_bytes!("../../card-game/index.html"));
            for url in meta["card_game"]["catalogs"].as_object().unwrap().values() {
                let url = url.as_str().unwrap();
                let response = router
                    .clone()
                    .oneshot(Request::builder().uri(url).body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(response.status(), axum::http::StatusCode::OK);
                let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
                let expected = cosyworld_orchestrator::card_assets::get(
                    url.strip_prefix("/card-game/").unwrap(),
                )
                .unwrap()
                .1;
                assert_eq!(&bytes[..], expected);
                serde_json::from_slice::<serde_json::Value>(&bytes).unwrap();
            }
        }
    }

    #[test]
    fn release_metadata_keeps_versions_and_exposes_game_at_the_top_level() {
        let value = serde_json::to_value(crate::projection_cache::MetaVersions::current()).unwrap();
        assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(
            value["content_engine_version"],
            crate::content_registry::content_engine_version()
        );
        assert!(value["primary_game"].is_string());
        assert_eq!(value["card_game"]["source_root"], "v2/card-game/");
        let source_commit = crate::projection_cache::source_commit;
        assert_eq!(
            source_commit(Some("80364A5BE2F0c1d2e3f4".into())).as_deref(),
            Some("80364a5be2f0")
        );
        assert_eq!(source_commit(Some("abc".into())), None);
        assert_eq!(source_commit(Some("not-a-sha".into())), None);
        assert_eq!(source_commit(None), None);
    }
}
