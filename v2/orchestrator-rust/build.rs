fn main() {
    println!("cargo:rerun-if-changed=../core-c/include/cosy_kernel.h");
    println!("cargo:rerun-if-changed=../core-c/src/cosy_kernel.c");
    println!("cargo:rerun-if-changed=src/index.html");
    println!("cargo:rerun-if-changed=../card-game");
    println!("cargo:rerun-if-changed=src/seed_content.json");

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
