#[path = "local_launcher.rs"]
mod local_launcher;
#[path = "../../local/models.rs"]
mod models;

use std::{ffi::OsString, io, path::PathBuf};

const HELP: &str = "Usage: cosyworld-orchestrator local [--with-voice]\n       cosyworld-orchestrator local prepare [--model NAME] [--directory PATH]";

pub(super) async fn run(args: impl IntoIterator<Item = OsString>) -> io::Result<()> {
    let mut args = args.into_iter();
    match args.next().as_deref() {
        None => local_launcher::run(false).await,
        Some(command) if command == "prepare" => {
            let mut model = "gemma3:4b".to_string();
            let mut directory = PathBuf::from(".runtime/models");
            while let Some(flag) = args.next() {
                let value = args.next().ok_or_else(|| io::Error::other(HELP))?;
                match flag.to_str() {
                    Some("--model") => {
                        model = value.into_string().map_err(|_| io::Error::other(HELP))?
                    }
                    Some("--directory") => directory = value.into(),
                    _ => return Err(io::Error::other(HELP)),
                }
            }
            tokio::task::spawn_blocking(move || {
                models::prepare(&directory, &model).map_err(io::Error::other)?;
                println!(
                    "{}",
                    models::path(&directory, &model)
                        .map_err(io::Error::other)?
                        .display()
                );
                Ok(())
            })
            .await?
        }
        Some(command) if command == "--with-voice" && args.next().is_none() => {
            local_launcher::run(true).await
        }
        Some(command) if command == "--help" || command == "-h" => {
            println!("{HELP}");
            Ok(())
        }
        _ => Err(io::Error::other(HELP)),
    }
}
