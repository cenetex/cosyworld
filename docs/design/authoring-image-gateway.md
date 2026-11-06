# Authoring image gateway

Checked against the primary provider docs and public catalog on 2026-11-06.
The gateway accepts one bounded inline reference and returns one verified raster.
Authoring will bind `openai/gpt-image-2.6-flare` in its own request configuration.
Global capability pins and existing journal and resident defaults stay intact.

The [OpenRouter model catalog](https://openrouter.ai/api/v1/images/models/openai/gpt-image-2.6-flare/endpoints)
lists image references, transparent backgrounds, PNG, WebP, JPEG, and the
square, portrait and landscape ratios used here. Its low, medium and high
quality settings are supported. The gateway requires PNG or WebP for alpha
output and checks the returned format against the requested format.
The [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare)
also lists text and image input, image generation and image editing.

Empty options preserve existing request fields and request hashes. Explicit
options become part of the hash. Reference MIME types must match the bytes,
and the selected registry entry must accept image input. The gateway sends
the inline bytes through OpenRouter's
[Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).

The authoring route will use the accepted portrait as the reference for one
transparent 3-by-2 pose sheet. The client slices six cells in fixed order:
Happy, Sad, Strike, Brace, Hit and Sleep. Each cell receives its own review.
A new accepted portrait changes the reference identity and requires fresh review.
Reference images guide identity; the
[image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
describes remaining character consistency limits.

The app keeps seed text, instructions and expanded prompts in request memory.
Provider retention follows separate account and endpoint policies.
[OpenAI's data guide](https://developers.openai.com/api/docs/guides/your-data)
describes default abuse monitoring retention, and
[OpenRouter's privacy guide](https://openrouter.ai/docs/guides/features/zdr)
explains safety retention and account controls. The future authoring binding
will record provider-default retention. Accepted output storage belongs to
the authoring save path; this gateway returns bytes to its caller.
