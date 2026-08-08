fn main() {
    println!("cargo:rerun-if-changed=../core-c/include/cosy_kernel.h");
    println!("cargo:rerun-if-changed=../core-c/src/cosy_kernel.c");
    println!("cargo:rerun-if-changed=csrc/abi_shim.c");

    cc::Build::new()
        .include("../core-c/include")
        .file("../core-c/src/cosy_kernel.c")
        .file("csrc/abi_shim.c")
        .flag_if_supported("-std=c11")
        .warnings(true)
        .compile("cosy_kernel_spine");
}
