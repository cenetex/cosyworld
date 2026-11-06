use serde::Serialize;
use serde_json::Value;

/// Empty options preserve each existing caller's provider defaults.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
pub(crate) struct ImageGenerationOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) background: Option<ImageBackground>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) output_format: Option<ImageFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) quality: Option<ImageQuality>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) aspect_ratio: Option<ImageAspectRatio>,
}

// These choices are consumed by the authoring image route in the next slice.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ImageBackground {
    Auto,
    Opaque,
    Transparent,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ImageFormat {
    Png,
    Webp,
    Jpeg,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ImageQuality {
    Low,
    Medium,
    High,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub(crate) enum ImageAspectRatio {
    #[serde(rename = "1:1")]
    Square,
    #[serde(rename = "2:3")]
    Portrait,
    #[serde(rename = "3:2")]
    Landscape,
}

impl ImageGenerationOptions {
    pub(crate) fn fields(self) -> Result<Value, &'static str> {
        if self.background == Some(ImageBackground::Transparent)
            && !matches!(
                self.output_format,
                Some(ImageFormat::Png | ImageFormat::Webp)
            )
        {
            return Err("transparent image output requires PNG or WebP");
        }
        Ok(serde_json::to_value(self).expect("image options serialize"))
    }

    pub(crate) fn content_type(self) -> Option<&'static str> {
        self.output_format.map(|format| match format {
            ImageFormat::Png => "image/png",
            ImageFormat::Webp => "image/webp",
            ImageFormat::Jpeg => "image/jpeg",
        })
    }
}
