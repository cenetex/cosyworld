use super::*;
use crate::ai_gateway::{image_options::*, ImageGenerationReference, ImageGenerationRequest};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{ImageDecoder, ImageReader, Limits};
use sha2::{Digest, Sha256};
use std::{io::Cursor, sync::Arc};

pub(super) const ROUTE: &str = "/card-game/authoring/generate/image";
pub(super) const MODEL: &str = "openai/gpt-image-2.6-flare";
const VOID_MODEL_REVISION: &str = "openai/gpt-image-2.6-flare-20261104";
const PORTRAIT_WIDTH: u32 = 1024;
const PORTRAIT_HEIGHT: u32 = 1536;

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(ROUTE, post(generate))
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
}

fn config(state: &AppState) -> Option<ai_gateway::AiConfig> {
    let mut config = state.ai_config.as_ref().clone()?;
    if config.api_key.trim().is_empty()
        || (config.base_url != "https://openrouter.ai/api/v1"
            && !(cfg!(test) && ai_gateway::local_ai_base_url(&config.base_url)))
    {
        return None;
    }
    let registry = json!({"schema_version":1,"snapshot_version":"authoring-flare-2026-11-06",
        "declared":[{"requested_model_id":MODEL,"provider":"openrouter","concrete_model":{"model_id":MODEL},
        "input_modalities":["text","image"],"output_modalities":["image"],"capabilities":["image_generation"],
        "data_policy":{"retention":"provider_default","training":"unknown"},
        "prompt_adapter":{"id":"openrouter-image","version":"1"}}]});
    config.registry = Some(Arc::new(
        ai_gateway::CapabilityRegistrySnapshot::from_json(&registry.to_string()).ok()?,
    ));
    config
        .capability_models
        .insert(ai_gateway::ModelCapability::ImageGeneration, MODEL.into());
    Some(config)
}

pub(crate) async fn draw_void_portrait(state: &AppState) -> Result<Vec<u8>, &'static str> {
    draw_model_void_portrait(
        state,
        "elysium-void-001",
        "A silver, humanlike resident of Void 001 with a discernible inhuman face. \
         Fine silver engraving, deep black fabric and one restrained gold filament in the folds. \
         Black-paper etching on the figure only, with strong contours and a complete silhouette.",
    )
    .await
}

pub(crate) async fn draw_model_void_portrait(
    state: &AppState,
    resident: &str,
    appearance: &str,
) -> Result<Vec<u8>, &'static str> {
    let config = config(state).ok_or("generation_unconfigured")?;
    let _permit = super::admission::admit(
        super::scope(state),
        super::admission::Pool::Image,
        resident,
        Instant::now(),
    )
    .map_err(|error| error.code)?;
    let input = Input {
        kind: "avatar".into(),
        role: "portrait".into(),
        description: appearance.into(),
        instruction: None,
        reference: None,
        basis: resident.into(),
    };
    run(config, input, None, true)
        .await
        .map(|drawn| drawn.bytes)
        .map_err(|error| error.code)
}

fn void_portrait_png(bytes: &[u8], mime: &str) -> Result<Vec<u8>, &'static str> {
    let source = raster(bytes, mime, false)
        .inspect_err(|_| {
            tracing::warn!(mime, size = bytes.len(), "Void portrait raster rejected");
        })?
        .into_rgba8();
    let (width, height) = source.dimensions();
    let (scaled_width, expected_width) = (u64::from(width) * 3, u64::from(height) * 2);
    // A provider's pixel dimensions may round the requested ratio. Allow 5%.
    if scaled_width.abs_diff(expected_width) > expected_width / 20 {
        tracing::warn!(
            width,
            height,
            "Void portrait has an unexpected aspect ratio"
        );
        return Err(IMAGE_INVALID);
    }
    let transparent = source.pixels().any(|pixel| pixel[3] == 0);
    let figure = source.pixels().any(|pixel| pixel[3] >= 128);
    if !transparent || !figure {
        tracing::warn!(
            width,
            height,
            transparent,
            figure,
            "Void portrait has no transparent frame or visible figure"
        );
        return Err(IMAGE_INVALID);
    }
    let fitted = image::DynamicImage::ImageRgba8(source).resize(
        PORTRAIT_WIDTH,
        PORTRAIT_HEIGHT,
        image::imageops::FilterType::Lanczos3,
    );
    if (fitted.width(), fitted.height()) == (PORTRAIT_WIDTH, PORTRAIT_HEIGHT) {
        return encode_png(fitted);
    }
    let fitted = fitted.into_rgba8();
    let mut canvas = image::RgbaImage::new(PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
    image::imageops::replace(
        &mut canvas,
        &fitted,
        i64::from((PORTRAIT_WIDTH - fitted.width()) / 2),
        i64::from((PORTRAIT_HEIGHT - fitted.height()) / 2),
    );
    encode_png(image::DynamicImage::ImageRgba8(canvas))
}

fn accepts_model(resolved: &str, void_portrait: bool) -> bool {
    resolved == MODEL || (void_portrait && resolved == VOID_MODEL_REVISION)
}

async fn generate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Input>,
) -> Response {
    let owner = match owner(&state, headers, true).await {
        Ok(owner) => owner,
        Err(failed) => return failed.response(),
    };
    match ready(&state, input).await {
        Ok(run) => respond(&state, owner, run).await,
        Err(failed) => failed.response(),
    }
}

/// The finished picture. Only pixels survive: the PNG is re-encoded from the decode.
pub(super) struct Drawn {
    pub bytes: Vec<u8>,
    pub basis: String,
    pub usage: Value,
}
impl Drawn {
    pub(super) fn sha256(&self) -> String {
        digest(&self.bytes)
    }
    pub(super) fn body(&self) -> Value {
        json!({"image":{"base64":BASE64.encode(&self.bytes),"mime":"image/png","sha256":self.sha256(),"size":self.bytes.len()},"basis":self.basis,"model":MODEL,"usage":self.usage})
    }
}

/// Check the request and the configured model. Decoding a reference is slow, so it runs off the reactor.
pub(super) async fn ready(state: &AppState, input: Input) -> Result<Run, Failed> {
    let Some(config) = config(state) else {
        return Err(Failed::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Image generation needs its configured model.",
            "generation_unconfigured",
        ));
    };
    let prepared =
        tokio::task::spawn_blocking(move || prepare(&input).map(|reference| (input, reference)))
            .await;
    match prepared {
        Ok(Ok((input, reference))) => Ok(Run {
            pool: admission::Pool::Image,
            work: Work::Image(config, input, reference),
        }),
        Ok(Err(error)) => Err(Failed::new(StatusCode::BAD_REQUEST, error, INVALID_REQUEST)),
        Err(_) => Err(Failed::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Image generation needs another try.",
            "generation_interrupted",
        )),
    }
}

pub(super) async fn run(
    config: ai_gateway::AiConfig,
    input: Input,
    reference: Option<Vec<u8>>,
    void_portrait: bool,
) -> Result<Drawn, Failed> {
    let sheet = input.role == "pose-sheet";
    let framing = if sheet {
        "Create one 3-column by 2-row sheet with equal cells. Reading order: happy, sad, strike, brace, hit, sleep. Keep a complete figure inside each cell with transparent margins and consistent framing."
    } else if input.kind == "location" {
        "Paint a complete place scene."
    } else {
        "Paint one complete subject surrounded by transparent margins."
    };
    let prompt = image_prompt(&input, framing);
    let result = ai_gateway::request_image_generation_for_key(
        &config,
        ImageGenerationRequest {
            feature: if void_portrait {
                "elysium_portrait"
            } else {
                "authoring_image"
            },
            prompt_version: if void_portrait {
                "elysium-void-001/1"
            } else {
                "authoring-image/2"
            },
            prompt: &prompt,
            reference: reference.as_ref().map(|bytes| ImageGenerationReference {
                bytes,
                content_type: &input.reference.as_ref().unwrap().mime,
            }),
            options: ImageGenerationOptions {
                output_format: Some(ImageFormat::Png),
                quality: Some(ImageQuality::Medium),
                background: Some(if input.kind == "location" {
                    ImageBackground::Opaque
                } else {
                    ImageBackground::Transparent
                }),
                aspect_ratio: Some(if sheet || input.kind == "location" {
                    ImageAspectRatio::Landscape
                } else if input.kind == "avatar" {
                    ImageAspectRatio::Portrait
                } else {
                    ImageAspectRatio::Square
                }),
            },
            timeout: Duration::from_secs(150),
            max_attempts: 1,
            referer: "https://lonelyforest.com/make",
        },
        &input.basis,
    )
    .await;
    let output = match result {
        Ok(output) if accepts_model(&output.model_attribution.resolved_model_id, void_portrait) => {
            output
        }
        Ok(_) => {
            if void_portrait {
                tracing::warn!("Void portrait image model attribution rejected");
            }
            return Err(Failed::new(
                StatusCode::BAD_GATEWAY,
                "The image came from a different model than expected and was discarded. Try again.",
                "image_model_unexpected",
            ));
        }
        Err(error) => {
            if void_portrait {
                tracing::warn!(
                    code = error.code(),
                    http_status = error.provider_http_status(),
                    "Void portrait image request failed"
                );
            }
            return Err(provider_failure(admission::Pool::Image, &error));
        }
    };
    let usage = serde_json::to_value(&output.usage).unwrap_or(Value::Null);
    let image = tokio::task::spawn_blocking(move || {
        if void_portrait {
            void_portrait_png(&output.bytes, &output.content_type)
        } else {
            png_output(&output.bytes, &output.content_type, sheet)
        }
    })
    .await;
    match image {
        Ok(Ok(bytes)) => Ok(Drawn {
            bytes,
            basis: input.basis,
            usage,
        }),
        _ => Err(Failed::new(
            StatusCode::BAD_GATEWAY,
            if sheet {
                "The pose sheet came back in a layout that does not split into six equal cells. Try again."
            } else {
                "The image came back in a form we could not use. Try again."
            },
            "image_layout_invalid",
        )),
    }
}

fn image_prompt(input: &Input, framing: &str) -> String {
    format!(
        "Paint game art. Preserve the subject's identity, clothing and art style from the reference when present. {framing}\nUse only the visible physical appearance described below. Do not invent character attributes, illustrate dialogue, goals, personality, abilities or story events. No speech bubbles, thought bubbles, text, letters, captions, labels, question marks, symbols, borders or watermarks, even if the reference contains them. Express poses through the body and face only.\nPhysical description: {}\nVisual changes only: {}",
        input.description, input.instruction.as_deref().unwrap_or("")
    )
}

const MAX_IMAGE: usize = 8 * 1024 * 1024;
const INVALID: &str = "Check the image role, description, reference and current design.";
const IMAGE_INVALID: &str = "Choose a complete PNG or WebP within the image limits.";

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Input {
    kind: String,
    role: String,
    description: String,
    instruction: Option<String>,
    reference: Option<Reference>,
    basis: String,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Reference {
    base64: String,
    mime: String,
    sha256: String,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(super) fn prepare(input: &Input) -> Result<Option<Vec<u8>>, &'static str> {
    if !matches!(input.kind.as_str(), "avatar" | "location" | "item")
        || !matches!(input.role.as_str(), "portrait" | "pose-sheet")
        || input.description.trim().is_empty()
        || input.description.encode_utf16().count() > 1200
        || input
            .instruction
            .as_ref()
            .is_some_and(|v| v.encode_utf16().count() > 2000)
        || input.basis.len() > 512
        || (input.role == "pose-sheet" && (input.kind != "avatar" || input.reference.is_none()))
        || (input.instruction.as_ref().is_some_and(|v| !v.is_empty()) && input.reference.is_none())
    {
        return Err(INVALID);
    }
    let basis: (String, u64, Option<String>, u64) =
        serde_json::from_str(&input.basis).map_err(|_| INVALID)?;
    if basis.0.is_empty()
        || basis.0.len() > 128
        || !basis
            .0
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        || basis.1 > 9_007_199_254_740_991
        || basis.3 > 9_007_199_254_740_991
        || basis.2.as_ref().is_some_and(|v| !hex(v))
        || serde_json::to_string(&basis).map_err(|_| INVALID)? != input.basis
    {
        return Err(INVALID);
    }
    let Some(reference) = &input.reference else {
        return Ok(None);
    };
    if !hex(&reference.sha256)
        || basis.2.as_deref() != Some(reference.sha256.as_str())
        || reference.base64.len() > MAX_IMAGE.div_ceil(3) * 4
    {
        return Err(INVALID);
    }
    let bytes = BASE64.decode(&reference.base64).map_err(|_| INVALID)?;
    if BASE64.encode(&bytes) != reference.base64 || digest(&bytes) != reference.sha256 {
        return Err(INVALID);
    }
    raster(&bytes, &reference.mime, false)?;
    Ok(Some(bytes))
}

fn raster(bytes: &[u8], mime: &str, sheet: bool) -> Result<image::DynamicImage, &'static str> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE {
        return Err(IMAGE_INVALID);
    }
    let format = match mime {
        "image/png" => image::ImageFormat::Png,
        "image/webp" => image::ImageFormat::WebP,
        _ => return Err(IMAGE_INVALID),
    };
    if image::guess_format(bytes).map_err(|_| IMAGE_INVALID)? != format {
        return Err(IMAGE_INVALID);
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let decoder = reader.into_decoder().map_err(|_| IMAGE_INVALID)?;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || u64::from(width) * u64::from(height) > 16_000_000
        || decoder.total_bytes() > 64_000_000
        || (sheet && (width % 3 != 0 || height % 2 != 0))
    {
        return Err(IMAGE_INVALID);
    }
    image::DynamicImage::from_decoder(decoder).map_err(|_| IMAGE_INVALID)
}

fn png_output(bytes: &[u8], mime: &str, sheet: bool) -> Result<Vec<u8>, &'static str> {
    encode_png(raster(bytes, mime, sheet)?)
}

fn encode_png(image: image::DynamicImage) -> Result<Vec<u8>, &'static str> {
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|_| IMAGE_INVALID)?;
    if output.get_ref().len() > MAX_IMAGE {
        return Err(IMAGE_INVALID);
    }
    Ok(output.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn png(pixels: RgbaImage) -> Vec<u8> {
        encode_png(image::DynamicImage::ImageRgba8(pixels)).unwrap()
    }

    #[test]
    fn only_void_portraits_allow_the_verified_flare_revision() {
        assert!(accepts_model(MODEL, false));
        assert!(accepts_model(MODEL, true));
        assert!(!accepts_model(VOID_MODEL_REVISION, false));
        assert!(accepts_model(VOID_MODEL_REVISION, true));
        assert!(!accepts_model("openai/gpt-image-2.6-flare-20261105", true));
        assert!(!accepts_model("openai/gpt-image-2.5-flare", true));
    }

    #[test]
    fn void_portraits_fit_off_ratio_frames_without_cropping() {
        let source = RgbaImage::from_fn(99, 150, |x, y| {
            if (30..120).contains(&y) && x < 10 {
                Rgba([220, 10, 5, 255])
            } else if (30..120).contains(&y) && x > 88 {
                Rgba([5, 10, 220, 255])
            } else {
                Rgba([0, 0, 0, 0])
            }
        });
        let bytes = void_portrait_png(&png(source), "image/png").unwrap();
        let portrait = image::load_from_memory(&bytes).unwrap().into_rgba8();
        assert_eq!(portrait.dimensions(), (1024, 1536));
        assert_eq!(portrait.get_pixel(0, 768)[3], 0);
        assert_eq!(portrait.get_pixel(1023, 768)[3], 0);
        assert_eq!(*portrait.get_pixel(6, 768), Rgba([220, 10, 5, 255]));
        assert_eq!(*portrait.get_pixel(1017, 768), Rgba([5, 10, 220, 255]));
    }

    #[test]
    fn void_portraits_reject_opaque_empty_and_wide_sources() {
        let mut wide = RgbaImage::new(8, 6);
        wide.put_pixel(0, 0, Rgba([30, 30, 30, 255]));
        for invalid in [
            RgbaImage::from_pixel(2, 3, Rgba([40, 40, 40, 255])),
            RgbaImage::new(2, 3),
            wide,
        ] {
            assert_eq!(
                void_portrait_png(&png(invalid), "image/png"),
                Err(IMAGE_INVALID)
            );
        }
    }
}
