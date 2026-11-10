/// Maximum persisted UTF-8 byte length for a visual-review summary. The
/// provider response parser and durable verdict builder both normalize through
/// `bounded_visual_verdict_summary`, so multi-byte punctuation cannot pass one
/// boundary and fail the next.
pub(crate) const MEDIA_VISUAL_VERDICT_SUMMARY_LIMIT: usize = 240;

pub(crate) fn bounded_visual_verdict_summary(value: &str) -> String {
    bounded_text(value, MEDIA_VISUAL_VERDICT_SUMMARY_LIMIT)
}

fn bounded_text(value: &str, maximum: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut end = compact.len().min(maximum);
    while !compact.is_char_boundary(end) {
        end -= 1;
    }
    compact[..end].to_string()
}
