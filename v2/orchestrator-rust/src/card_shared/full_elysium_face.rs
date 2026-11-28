//! A Void resident's generated portrait as a public, square Discord face.
use super::{directory, hash, read_portrait, resident};
use crate::AppState;
use axum::{
    extract::{Path as RoutePath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use image::{imageops, DynamicImage, ImageFormat, RgbaImage};

pub(in super::super) const FACE_ROUTE: &str = "/card-game/elysium-face/{resident}/{file}";
const SIDE: u32 = 256;

/// The face path for a resident's current portrait; the hash changes with it.
pub(crate) async fn elysium_face_path(state: &AppState, id: &str) -> Option<String> {
    let dir = directory(&state.generated_asset_dir, resident(id)?);
    let bytes = tokio::task::spawn_blocking(move || read_portrait(&dir))
        .await
        .ok()??;
    Some(format!("/card-game/elysium-face/{id}/{}.png", hash(&bytes)))
}

pub(in super::super) async fn face(
    State(state): State<AppState>,
    RoutePath((id, file)): RoutePath<(String, String)>,
) -> Response {
    let Some(resident) = resident(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let dir = directory(&state.generated_asset_dir, resident);
    let made = tokio::task::spawn_blocking(move || {
        let bytes = read_portrait(&dir)?;
        (file == format!("{}.png", hash(&bytes))).then(|| crop(&bytes))?
    })
    .await
    .ok()
    .flatten();
    match made {
        Some(png) => (
            [
                (header::CONTENT_TYPE, "image/png"),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ],
            png,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// The head and shoulders: the top quarter of the figure, centred on its head.
fn crop(png: &[u8]) -> Option<Vec<u8>> {
    let image: RgbaImage = image::load_from_memory_with_format(png, ImageFormat::Png)
        .ok()?
        .into_rgba8();
    let (width, height) = image.dimensions();
    let solid = |x: u32, y: u32| image.get_pixel(x, y)[3] >= 128;
    let row = |y: u32| (0..width).any(|x| solid(x, y));
    let top = (0..height).find(|&y| row(y))?;
    let bottom = (top..height).rev().find(|&y| row(y))?;
    let side = ((bottom - top) / 4).clamp(16, width.min(height));
    let head: Vec<u32> = (top..(top + side / 2).min(height))
        .flat_map(|y| (0..width).filter(move |&x| solid(x, y)))
        .collect();
    let centre = head.iter().map(|&x| u64::from(x)).sum::<u64>() / head.len().max(1) as u64;
    let left = u32::try_from(centre)
        .ok()?
        .saturating_sub(side / 2)
        .min(width - side);
    let start = top.saturating_sub(side / 12).min(height - side);
    let face = imageops::crop_imm(&image, left, start, side, side).to_image();
    let face = imageops::resize(&face, SIDE, SIDE, imageops::FilterType::Lanczos3);
    let mut out = Vec::new();
    DynamicImage::ImageRgba8(face)
        .write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::Png)
        .ok()?;
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn figure() -> Vec<u8> {
        let mut image = RgbaImage::new(400, 600);
        for y in 100..580 {
            for x in 150..250 {
                image.put_pixel(x, y, image::Rgba([200, 200, 200, 255]));
            }
        }
        for y in 100..160 {
            for x in 180..220 {
                image.put_pixel(x, y, image::Rgba([255, 0, 0, 255]));
            }
        }
        let mut png = Vec::new();
        DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png)
            .unwrap();
        png
    }

    #[test]
    fn the_face_is_a_square_around_the_figure_head() {
        let png = figure();
        let face = image::load_from_memory(&crop(&png).unwrap())
            .unwrap()
            .into_rgba8();
        assert_eq!(face.dimensions(), (SIDE, SIDE));
        assert!(face.get_pixel(SIDE / 2, SIDE / 6)[3] > 0);
        assert!(crop(&[0; 8]).is_none());
    }

    #[tokio::test]
    async fn a_drawn_portrait_gets_a_public_face_named_by_its_hash() {
        let mut state = crate::test_support::test_app_state(None);
        let root = std::env::temp_dir().join(format!("void-face-{}", crate::random_hex(8)));
        state.generated_asset_dir = std::sync::Arc::new(root.clone());
        assert_eq!(elysium_face_path(&state, "elysium-claude").await, None);
        let png = figure();
        let dir = root.join("elysium-models/elysium-claude");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{}.png", hash(&png))), &png).unwrap();
        let path = elysium_face_path(&state, "elysium-claude").await.unwrap();
        assert_eq!(
            path,
            format!("/card-game/elysium-face/elysium-claude/{}.png", hash(&png))
        );
        let file = path.rsplit('/').next().unwrap().to_string();
        let ask = |file: String| {
            face(
                State(state.clone()),
                RoutePath(("elysium-claude".into(), file)),
            )
        };
        assert_eq!(ask(file).await.status(), StatusCode::OK);
        assert_eq!(
            ask("stale.png".into()).await.status(),
            StatusCode::NOT_FOUND
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
