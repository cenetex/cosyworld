use super::*;
use crate::ai_gateway::{image_options::*, ImageGenerationReference, ImageGenerationRequest};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{ImageDecoder, ImageReader, Limits};
use sha2::{Digest, Sha256};
use std::{io::Cursor, sync::Arc};

pub(super) const ROUTE: &str = "/card-game/authoring/generate/image";
pub(super) const MODEL: &str = "openai/gpt-image-2.6-flare";

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
    /// The synchronous route's reply.
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
            feature: "authoring_image",
            prompt_version: "authoring-image/2",
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
    let output =
        match result {
            Ok(output) if output.model_attribution.resolved_model_id == MODEL => output,
            Ok(_) => return Err(Failed::new(
                StatusCode::BAD_GATEWAY,
                "The image came from a different model than expected and was discarded. Try again.",
                "image_model_unexpected",
            )),
            Err(error) => return Err(provider_failure(admission::Pool::Image, &error)),
        };
    let usage = serde_json::to_value(&output.usage).unwrap_or(Value::Null);
    let image =
        tokio::task::spawn_blocking(move || png_output(&output.bytes, &output.content_type, sheet))
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
    let mut output = Cursor::new(Vec::new());
    raster(bytes, mime, sheet)?
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|_| IMAGE_INVALID)?;
    if output.get_ref().len() > MAX_IMAGE {
        return Err(IMAGE_INVALID);
    }
    Ok(output.into_inner())
}
