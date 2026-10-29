# QuickJS array search correction

This directory contains the native build sources and all shipped Rust bindings
from `rquickjs-sys` 0.14.0, which embeds QuickJS-NG 0.16.2. The source crate is
available at <https://crates.io/crates/rquickjs-sys/0.14.0>.

The original crate archive has SHA-256
`cee271d0eeba64f0915b846cb7ae02e16faf3dfdffdca91731101d9d30fe3423`.
The Rust license comes from the matching `rquickjs` 0.14.0 crate. The QuickJS
license is in `quickjs/LICENSE`. CosyWorld builds this crate for its native
service and Mac helper. The upstream WebAssembly SDK and prebuilt C library are
outside this native source copy.

The sole interpreter change sets `val = JS_UNDEFINED` after releasing a
non-matching value in `js_array_find`. This keeps the exception cleanup safe
when the deadline interrupts the next iteration. It applies to `find`,
`findIndex`, `findLast` and `findLastIndex`. The upstream report and maintainer
review are at <https://github.com/quickjs-ng/quickjs/issues/1792>.

CosyWorld keeps the same interpreter version, assertions, memory limit,
execution deadline and saved rules. The native regression checks successful
searches and safe error recovery after interrupted searches. A future upstream
release containing this correction can replace this local source copy after
the same checks pass.
