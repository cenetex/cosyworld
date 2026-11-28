fn main() {
    println!("cargo:rerun-if-changed=../core-c/include/card_table.h");
    println!("cargo:rerun-if-changed=../core-c/src/card_table.c");
    cc::Build::new()
        .include("../core-c/include")
        .file("../core-c/src/card_table.c")
        .flag_if_supported("-std=c11")
        .warnings(true)
        .compile("cosy_kernel");
}
