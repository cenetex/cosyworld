use rquickjs::{Context, Runtime};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[test]
fn array_searches_keep_owned_values_after_interruption() {
    // Exercise the patched native library through the same Rust API as the
    // shared rules. A cancelled request must leave owned values safe to drop.
    for method in ["find", "findIndex", "findLast", "findLastIndex"] {
        let runtime = Runtime::new().unwrap();
        runtime.set_memory_limit(96 * 1024 * 1024);
        runtime.set_max_stack_size(1024 * 1024);
        let interrupted = Arc::new(AtomicBool::new(false));
        let signal = interrupted.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || signal.load(Ordering::Relaxed))));
        let context = Context::full(&runtime).unwrap();
        context.with(|ctx| {
            ctx.eval::<(), _>(
                "var items = Array.from({ length: 20000 }, (_, value) => ({ value }));",
            )
            .unwrap();
            let search = format!("items.{method}(item => item.value === 123)");
            let expected = if method.ends_with("Index") {
                search.clone()
            } else {
                format!("({search}).value")
            };
            assert_eq!(ctx.eval::<i32, _>(expected).unwrap(), 123);
            interrupted.store(true, Ordering::Relaxed);
            let error = ctx.eval::<(), _>(format!("items.{method}(() => false)"));
            assert!(error.is_err(), "{method} must honor cancellation");
            let exception = ctx.catch();
            assert!(exception.is_error());
            drop(exception);
            interrupted.store(false, Ordering::Relaxed);
            assert!(ctx
                .eval::<bool, _>("items.every((item, index) => item.value === index)")
                .unwrap());
            assert_eq!(ctx.eval::<i32, _>("items.length").unwrap(), 20000);
        });
        runtime.run_gc();
        drop(context);
        runtime.run_gc();
    }
}
