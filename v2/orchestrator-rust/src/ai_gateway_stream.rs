use super::{PinnedModelSelection, Value};
use serde_json::json;

#[derive(Default)]
struct CompletionStream {
    pending: Vec<u8>,
    data: String,
    text: String,
    model: Option<String>,
    finish: Option<String>,
    usage: Value,
    done: bool,
    bytes: usize,
}
impl CompletionStream {
    fn push(
        &mut self,
        bytes: &[u8],
        emit: &dyn Fn(&str) -> bool,
        selection: Option<&PinnedModelSelection>,
    ) -> Result<(), String> {
        self.bytes += bytes.len();
        if self.bytes > 256 * 1024 {
            return Err("response exceeded its byte limit".into());
        }
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line = self.pending.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "invalid UTF-8")?
                .trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                let data = std::mem::take(&mut self.data);
                self.event(data.trim(), emit, selection)?;
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data.push_str(data.trim_start());
                self.data.push('\n');
            }
        }
        Ok(())
    }
    fn event(
        &mut self,
        data: &str,
        emit: &dyn Fn(&str) -> bool,
        selection: Option<&PinnedModelSelection>,
    ) -> Result<(), String> {
        if data.is_empty() || self.done {
            return Ok(());
        }
        if data == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let value: Value = serde_json::from_str(data).map_err(|_| "invalid stream event")?;
        if value.get("error").is_some() {
            return Err("provider ended with an error".into());
        }
        if let Some(model) = value["model"].as_str() {
            if let Some(selection) = selection {
                selection
                    .attribute_response(Some(model))
                    .map_err(|_| "model attribution changed")?;
            }
            if self
                .model
                .as_deref()
                .is_some_and(|previous| previous != model)
            {
                return Err("model changed during stream".into());
            }
            self.model = Some(model.into());
        }
        if value.get("usage").is_some_and(|usage| !usage.is_null()) {
            self.usage = value["usage"].clone();
        }
        if let Some(choice) = value["choices"]
            .as_array()
            .and_then(|choices| choices.first())
        {
            if let Some(reason) = choice["finish_reason"].as_str() {
                self.finish = Some(reason.into());
            }
            if let Some(text) = choice["delta"]["content"]
                .as_str()
                .filter(|text| !text.is_empty())
            {
                if self.text.len() + text.len() > 16 * 1024 {
                    return Err("text exceeded its byte limit".into());
                }
                self.text.push_str(text);
                if !emit(text) {
                    return Err("reader closed".into());
                }
            }
        }
        Ok(())
    }
    fn complete(self) -> Result<Value, String> {
        if !self.done || self.finish.is_none() || self.text.is_empty() {
            return Err("stream ended before completion".into());
        }
        Ok(
            json!({"model":self.model,"usage":self.usage,"choices":[{"finish_reason":self.finish,"message":{"content":self.text}}]}),
        )
    }
}

pub(super) async fn read_completion(
    mut response: reqwest::Response,
    emit: &(dyn Fn(&str) -> bool + Send + Sync),
    selection: Option<&PinnedModelSelection>,
) -> Result<Value, String> {
    let mut stream = CompletionStream::default();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "transport interrupted")?
    {
        stream.push(&chunk, emit, selection)?;
        if stream.done {
            break;
        }
    }
    stream.complete()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    #[test]
    fn streams_content_across_every_byte_boundary_and_preserves_usage() {
        let source = concat!(": heartbeat\r\n\r\n", "data: {\"model\":\"test\",\"choices\":[{\"delta\":{\"content\":\"Café\",\"reasoning\":\"private\"}}]}\r\n\r\n", "data: {\"choices\":[{\"delta\":{\"content\":\"?\"},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":8}}\n\n", "data: [DONE]\n\n");
        let seen = Mutex::new(String::new());
        let emit = |text: &str| {
            seen.lock().unwrap().push_str(text);
            true
        };
        let mut stream = CompletionStream::default();
        for byte in source.as_bytes() {
            stream.push(&[*byte], &emit, None).unwrap();
        }
        assert_eq!(*seen.lock().unwrap(), "Café?");
        let body = stream.complete().unwrap();
        assert_eq!(body["choices"][0]["message"]["content"], "Café?");
        assert_eq!(body["usage"]["total_tokens"], 8);
    }
    #[test]
    fn rejects_interrupted_failed_and_oversized_streams() {
        assert!(CompletionStream::default().complete().is_err());
        let mut stream = CompletionStream::default();
        assert!(stream
            .push(
                b"data: {\"error\":{\"message\":\"failure\"}}\n\n",
                &|_| true,
                None
            )
            .is_err());
        let mut stream = CompletionStream::default();
        assert!(stream
            .push(&vec![b'x'; 256 * 1024 + 1], &|_| true, None)
            .is_err());
        let mut stream = CompletionStream::default();
        assert!(stream
            .push(
                b"data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n",
                &|_| false,
                None
            )
            .is_err());
    }
}
