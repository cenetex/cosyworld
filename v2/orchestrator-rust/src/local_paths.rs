use std::{
    collections::BTreeMap,
    env,
    ffi::{OsStr, OsString},
    io,
    path::PathBuf,
};

pub(super) type Environment = BTreeMap<OsString, OsString>;

pub(super) fn data_directory(source: &Environment) -> io::Result<PathBuf> {
    source
        .get(OsStr::new("COSYWORLD_LOCAL_DATA_DIR"))
        .map(PathBuf::from)
        .or_else(|| env::home_dir().map(|home| home.join(".cosyworld")))
        .ok_or_else(|| io::Error::other("Choose a folder for the local app's saves and audio."))
}

pub(super) fn model_directory(source: &Environment) -> io::Result<PathBuf> {
    if let Some(directory) = source.get(OsStr::new("COSYWORLD_LOCAL_MODEL_DIR")) {
        return Ok(directory.into());
    }
    Ok(data_directory(source)?.join("models"))
}

pub(super) fn model_name(source: &Environment) -> &str {
    source
        .get(OsStr::new("COSYWORLD_LOCAL_MODEL"))
        .and_then(|name| name.to_str())
        .unwrap_or("gemma3:4b")
}

pub(super) fn launch_model_file(
    source: &Environment,
    prepared: PathBuf,
    legacy: PathBuf,
) -> PathBuf {
    if let Some(file) = source.get(OsStr::new("COSYWORLD_LLAMA_MODEL")) {
        return file.into();
    }
    if !source.contains_key(OsStr::new("COSYWORLD_LOCAL_MODEL_DIR"))
        && !prepared.is_file()
        && legacy.is_file()
    {
        return legacy;
    }
    prepared
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_data_and_model_overrides_share_one_preparation_directory() {
        let mut source =
            Environment::from([("COSYWORLD_LOCAL_DATA_DIR".into(), "/local data".into())]);
        assert_eq!(
            data_directory(&source).unwrap(),
            PathBuf::from("/local data")
        );
        assert_eq!(
            model_directory(&source).unwrap(),
            PathBuf::from("/local data/models")
        );
        assert_eq!(model_name(&source), "gemma3:4b");
        source.insert(
            "COSYWORLD_LOCAL_MODEL_DIR".into(),
            "/models elsewhere".into(),
        );
        source.insert("COSYWORLD_LOCAL_MODEL".into(), "gemma3:1b".into());
        assert_eq!(
            model_directory(&source).unwrap(),
            PathBuf::from("/models elsewhere")
        );
        assert_eq!(model_name(&source), "gemma3:1b");
    }

    #[test]
    fn an_explicit_model_file_wins_and_old_checkouts_keep_their_cache() {
        let existing = env::current_exe().unwrap();
        let missing = existing.join("model.gguf");
        let mut source = Environment::new();
        assert_eq!(
            launch_model_file(&source, missing.clone(), existing.clone()),
            existing
        );
        assert_eq!(
            launch_model_file(&source, existing.clone(), missing.clone()),
            existing
        );
        source.insert("COSYWORLD_LOCAL_MODEL_DIR".into(), "/custom models".into());
        assert_eq!(
            launch_model_file(&source, missing.clone(), existing.clone()),
            missing
        );
        source.insert("COSYWORLD_LLAMA_MODEL".into(), "explicit.gguf".into());
        assert_eq!(
            launch_model_file(&source, missing, existing),
            PathBuf::from("explicit.gguf")
        );
    }
}
