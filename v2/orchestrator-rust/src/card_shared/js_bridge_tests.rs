//! Worlds the Rust suite plays on, built by real play in the browser rules.
//! No recorded save is read: Node plays from `createWorld` on today's rules
//! and prints the save, as `pressured_game` does. A caller names the helper
//! module as a literal path, so the fast check reruns it when the helper moves.

/// The save that `build` (a call such as `longPlay()`) makes in the helper
/// module at `module` (a repo path under `test/helpers/`), as JSON text.
pub(super) fn played_save(module: &str, build: &str) -> String {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let script =
        format!("import * as m from './{module}'; console.log(JSON.stringify(m.{build}));");
    let output = std::process::Command::new("node")
        .current_dir(root)
        .args(["--input-type=module", "-e", &script])
        .output()
        .expect("Node 24 plays the world");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}
