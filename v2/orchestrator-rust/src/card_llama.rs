//! One local model and one bounded context, owned by one inference thread.
use super::{AiCompletion, AiFailureKind, AiGatewayError, AiTokenUsage, ChatCompletionRequest};
use llama_cpp_2::{
    context::{params::LlamaContextParams, LlamaContext},
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, LlamaChatMessage, LlamaModel},
    sampling::LlamaSampler,
    token::LlamaToken,
};
use std::{
    num::NonZeroU32,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, OnceLock,
    },
    time::{Duration, Instant},
};
use tokio::sync::oneshot;

static ENGINE: OnceLock<mpsc::SyncSender<Command>> = OnceLock::new();

enum Command {
    Generate(Job),
    Count {
        system: String,
        user: String,
        deadline: Instant,
        reply: oneshot::Sender<Result<usize, String>>,
    },
}

pub(crate) async fn count_tokens(
    system: &str,
    user: &str,
    timeout: Duration,
) -> Result<usize, String> {
    let sender = ENGINE.get().ok_or("Open the local dialogue model first.")?;
    let (reply, waiting) = oneshot::channel();
    sender
        .try_send(Command::Count {
            system: system.into(),
            user: user.into(),
            deadline: Instant::now() + timeout,
            reply,
        })
        .map_err(|_| "The local dialogue is finishing its last line.")?;
    tokio::time::timeout(timeout, waiting)
        .await
        .map_err(|_| "The reading needs another moment.")?
        .map_err(|_| "Open the local dialogue model again.")?
}

struct Job {
    system: String,
    user: String,
    max_tokens: u32,
    temperature: f32,
    cancelled: Arc<AtomicBool>,
    deadline: Instant,
    reply: oneshot::Sender<Result<Output, String>>,
}

struct Output {
    text: String,
    prompt_tokens: u64,
    generated_tokens: u64,
    cached_tokens: usize,
    stopped: bool,
}

struct Cancel(Arc<AtomicBool>);
impl Drop for Cancel {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

fn context_size(value: Option<&str>) -> Result<u32, String> {
    match value.unwrap_or("2048").parse::<u32>() {
        Ok(size @ 1024..=4096) => Ok(size),
        _ => Err("Choose a dialogue context from 1024 to 4096 tokens.".into()),
    }
}

pub(crate) async fn start() -> Result<(), String> {
    let path = PathBuf::from(
        std::env::var_os("COSYWORLD_LLAMA_MODEL").ok_or("Prepare the dialogue model first.")?,
    );
    let bytes = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if bytes > 3 * 1024 * 1024 * 1024 || bytes < 1024 {
        return Err("Choose the Standard or Light dialogue model for this app.".into());
    }
    let context = context_size(std::env::var("COSYWORLD_LLAMA_CONTEXT").ok().as_deref())?;
    let (sender, receiver) = mpsc::sync_channel(2);
    let (ready, waiting) = oneshot::channel();
    ENGINE
        .set(sender)
        .map_err(|_| "The dialogue model is already open.")?;
    std::thread::Builder::new()
        .name("local-dialogue".into())
        .spawn(move || {
            let mut ready = Some(ready);
            if let Err(error) = worker(path, context, receiver, &mut ready) {
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Err(error.clone()));
                }
                tracing::error!(feature="embedded_llama", %error, "Local dialogue stopped");
            }
        })
        .map_err(|e| e.to_string())?;
    waiting
        .await
        .map_err(|_| "The dialogue model needs a restart.".to_string())?
}

pub(crate) async fn complete(
    request: ChatCompletionRequest<'_>,
    model: &str,
) -> Result<AiCompletion, AiGatewayError> {
    let started = Instant::now();
    let failure = |message: String| AiGatewayError {
        kind: AiFailureKind::Client,
        message,
        attempts: 1,
        latency: started.elapsed(),
    };
    let sender = ENGINE
        .get()
        .ok_or_else(|| failure("Open the local dialogue model first.".into()))?;
    if request.response_format.is_some() || request.max_tokens > 256 {
        return Err(failure(
            "Choose a short character reply for local dialogue.".into(),
        ));
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let _cancel = Cancel(cancelled.clone());
    let (reply, waiting) = oneshot::channel();
    sender
        .try_send(Command::Generate(Job {
            system: request.system.into(),
            user: request.user.into(),
            max_tokens: request.max_tokens,
            temperature: request.temperature as f32,
            cancelled,
            deadline: started + request.timeout,
            reply,
        }))
        .map_err(|_| failure("The local dialogue is finishing its last line.".into()))?;
    let output = tokio::time::timeout(request.timeout, waiting)
        .await
        .map_err(|_| failure("The local dialogue needs another try.".into()))?
        .map_err(|_| failure("Open the local dialogue model again.".into()))?
        .map_err(failure)?;
    tracing::info!(
        feature = "embedded_llama",
        model,
        prompt_tokens = output.prompt_tokens,
        generated_tokens = output.generated_tokens,
        cached_tokens = output.cached_tokens,
        latency_ms = started.elapsed().as_millis(),
        "Local reply ready"
    );
    Ok(AiCompletion {
        text: output.text,
        reasoning_trace: None,
        attempts: 1,
        latency: started.elapsed(),
        model_attribution: None,
        resolved_model_id: model.into(),
        finish_reason: if output.stopped { "stop" } else { "length" }.into(),
        usage: AiTokenUsage {
            prompt_tokens: Some(output.prompt_tokens),
            completion_tokens: Some(output.generated_tokens),
            total_tokens: Some(output.prompt_tokens + output.generated_tokens),
        },
        context_hash: super::exact_endpoint_context_hash(
            request.feature,
            request.prompt_version,
            None,
            &[request.system.into(), request.user.into()],
        ),
        prompt_version: request.prompt_version.into(),
    })
}

fn worker(
    path: PathBuf,
    context: u32,
    receiver: mpsc::Receiver<Command>,
    ready: &mut Option<oneshot::Sender<Result<(), String>>>,
) -> Result<(), String> {
    let started = Instant::now();
    let backend = LlamaBackend::init().map_err(|e| e.to_string())?;
    let params = LlamaModelParams::default().with_n_gpu_layers(if cfg!(target_os = "macos") {
        999
    } else {
        0
    });
    let model = LlamaModel::load_from_file(&backend, path, &params).map_err(|e| e.to_string())?;
    let params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(context))
        .with_n_batch(128)
        .with_n_ubatch(128)
        .with_n_threads(4)
        .with_n_threads_batch(8)
        .with_flash_attention_policy(1);
    let mut ctx = model
        .new_context(&backend, params)
        .map_err(|e| e.to_string())?;
    let mut cache = Vec::new();
    let (reply, _) = oneshot::channel();
    let warm = Job {
        system: "Speak briefly.".into(),
        user: "Hello.".into(),
        max_tokens: 1,
        temperature: 0.0,
        cancelled: Arc::new(AtomicBool::new(false)),
        deadline: Instant::now() + Duration::from_secs(60),
        reply,
    };
    generate(&model, &mut ctx, &mut cache, &warm)?;
    tracing::info!(
        feature = "embedded_llama",
        context,
        load_ms = started.elapsed().as_millis(),
        "Local model warmed"
    );
    if let Some(ready) = ready.take() {
        let _ = ready.send(Ok(()));
    }
    for command in receiver {
        let job = match command {
            Command::Generate(job) => job,
            Command::Count {
                system,
                user,
                deadline,
                reply,
            } => {
                if !reply.is_closed() && Instant::now() < deadline {
                    let count = prompt_tokens(&model, &system, &user).map(|tokens| tokens.len());
                    let _ = reply.send(count);
                }
                continue;
            }
        };
        if job.reply.is_closed() {
            continue;
        }
        let result = generate(&model, &mut ctx, &mut cache, &job);
        if result.is_err() {
            ctx.clear_kv_cache();
            cache.clear();
        }
        let _ = job.reply.send(result);
    }
    Ok(())
}

fn alive(job: &Job) -> Result<(), String> {
    if job.cancelled.load(Ordering::Relaxed) || Instant::now() >= job.deadline {
        Err("The scene has moved on.".into())
    } else {
        Ok(())
    }
}

fn prompt_tokens(model: &LlamaModel, system: &str, user: &str) -> Result<Vec<LlamaToken>, String> {
    let template = model.chat_template(None).map_err(|e| e.to_string())?;
    let chat = [
        LlamaChatMessage::new("system".into(), system.into()).map_err(|e| e.to_string())?,
        LlamaChatMessage::new("user".into(), user.into()).map_err(|e| e.to_string())?,
    ];
    let prompt = model
        .apply_chat_template(&template, &chat, true)
        .map_err(|e| e.to_string())?;
    let vocab = model.vocab();
    Ok(vocab.tokenize(prompt.as_bytes(), true, true))
}

fn generate(
    model: &LlamaModel,
    ctx: &mut LlamaContext<'_>,
    cache: &mut Vec<LlamaToken>,
    job: &Job,
) -> Result<Output, String> {
    alive(job)?;
    let tokens = prompt_tokens(model, &job.system, &job.user)?;
    let vocab = model.vocab();
    if tokens.is_empty() || tokens.len() + job.max_tokens as usize > ctx.n_ctx() as usize {
        return Err("This scene needs a shorter dialogue context.".into());
    }
    // Keep one prompt prefix. Long sliding-window histories start a fresh cache.
    let mut prefix = if cache.len() >= 1024 {
        0
    } else {
        shared_prefix(cache, &tokens).min(tokens.len() - 1)
    };
    if prefix == 0
        || !ctx
            .clear_kv_cache_seq(Some(0), Some(prefix as u32), None)
            .map_err(|e| e.to_string())?
    {
        ctx.clear_kv_cache();
        prefix = 0;
    }
    cache.truncate(prefix);
    let mut batch = LlamaBatch::new(128, 1);
    for chunk in tokens[prefix..].chunks(128) {
        alive(job)?;
        batch.clear();
        let position = cache.len();
        for (offset, token) in chunk.iter().enumerate() {
            batch
                .add(
                    *token,
                    (position + offset) as i32,
                    &[0],
                    position + offset + 1 == tokens.len(),
                )
                .map_err(|e| e.to_string())?;
        }
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;
        cache.extend_from_slice(chunk);
    }
    let mut sampler = if job.temperature <= 0.0 {
        LlamaSampler::greedy()
    } else {
        LlamaSampler::chain_simple([
            LlamaSampler::top_k(40),
            LlamaSampler::top_p(0.9, 1),
            LlamaSampler::temp(job.temperature),
            LlamaSampler::dist(rand::random()),
        ])
    };
    let mut bytes = Vec::new();
    let mut count = 0;
    let mut stopped = false;
    for _ in 0..job.max_tokens {
        alive(job)?;
        let token = sampler.sample(ctx, batch.n_tokens() - 1);
        sampler.accept(token);
        count += 1;
        if vocab.is_eog(token) {
            stopped = true;
            break;
        }
        bytes.extend(vocab.token_to_piece(token, false, None));
        batch.clear();
        batch
            .add(token, cache.len() as i32, &[0], true)
            .map_err(|e| e.to_string())?;
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;
        cache.push(token);
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| "The character line needs another try.".to_string())?;
    Ok(Output {
        text,
        prompt_tokens: tokens.len() as u64,
        generated_tokens: count,
        cached_tokens: prefix,
        stopped,
    })
}

fn shared_prefix<T: PartialEq>(left: &[T], right: &[T]) -> usize {
    left.iter().zip(right).take_while(|(a, b)| a == b).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn context_and_prefix_memory_stay_bounded() {
        assert_eq!(context_size(None).unwrap(), 2048);
        assert_eq!(context_size(Some("4096")).unwrap(), 4096);
        assert!(context_size(Some("32768")).is_err());
        assert_eq!(shared_prefix(&[1, 2, 3], &[1, 2, 4]), 2);
        assert_eq!(shared_prefix::<u32>(&[], &[1]), 0);
    }
}
