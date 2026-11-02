use std::{env, path::PathBuf, process::Command};

fn main() {
    build_card_assets();
    println!("cargo:rerun-if-changed=../core-c/include/cosy_kernel.h");
    println!("cargo:rerun-if-changed=../core-c/src/cosy_kernel.c");
    println!("cargo:rerun-if-changed=../card-game");

    println!("cargo:rerun-if-changed=../core-c/include/card_table.h");
    println!("cargo:rerun-if-changed=../core-c/src/card_table.c");
    cc::Build::new()
        .include("../core-c/include")
        .file("../core-c/src/cosy_kernel.c")
        .file("../core-c/src/card_table.c")
        .flag_if_supported("-std=c11")
        .warnings(true)
        .compile("cosy_kernel");
}

/// Generates the embedded card-game file list from public-assets.mjs. The
/// output depends only on the repository files, so a commit always produces
/// the same module and the same `manifest_sha256`.
fn build_card_assets() {
    println!("cargo:rerun-if-changed=../scripts/build-card-assets.mjs");
    // The asset list, its imports, and the hashed file bytes all live here.
    // Without this, a new public file or changed art would keep a stale
    // module and manifest hash in an incremental build.
    println!("cargo:rerun-if-changed=../card-game");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR")).join("card_assets.rs");
    let status = Command::new("node")
        .arg("../scripts/build-card-assets.mjs")
        .arg("--rust-out")
        .arg(&out)
        .status()
        .unwrap_or_else(|error| {
            panic!("Building the card asset list needs Node.js 22 or newer on PATH: {error}")
        });
    assert!(
        status.success(),
        "v2/scripts/build-card-assets.mjs failed: {status}"
    );
}
