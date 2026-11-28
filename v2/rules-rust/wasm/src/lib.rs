#![deny(unsafe_code)]

#[cfg(target_arch = "wasm32")]
mod guest {
    use cosyworld_rules::{MAX_JSON_BYTES, MAX_WIRE_BYTES};
    use std::cell::RefCell;

    thread_local! {
        static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
        static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }

    #[allow(unsafe_code, reason = "The WASM ABI requires unmangled export names")]
    #[no_mangle]
    pub extern "C" fn reserve_input(len: usize) -> usize {
        OUTPUT.with_borrow_mut(Vec::clear);
        INPUT.with_borrow_mut(|buffer| {
            buffer.clear();
            if len == 0 || len > MAX_WIRE_BYTES {
                return 0;
            }
            buffer.resize(len, 0);
            buffer.as_mut_ptr() as usize
        })
    }

    #[allow(unsafe_code, reason = "The WASM ABI requires unmangled export names")]
    #[no_mangle]
    pub extern "C" fn reduce() -> usize {
        let output = INPUT.with_borrow_mut(|input| {
            let parsed = serde_json::from_slice(input);
            input.clear();
            let result = cosyworld_rules::reduce(&parsed.ok()?);
            serde_json::to_vec(&result).ok()
        });
        OUTPUT.with_borrow_mut(|buffer| {
            *buffer = output
                .filter(|bytes| bytes.len() <= MAX_JSON_BYTES)
                .unwrap_or_default();
            buffer.len()
        })
    }

    #[allow(unsafe_code, reason = "The WASM ABI requires unmangled export names")]
    #[no_mangle]
    pub extern "C" fn output_ptr() -> usize {
        OUTPUT.with_borrow(|buffer| {
            if buffer.is_empty() {
                0
            } else {
                buffer.as_ptr() as usize
            }
        })
    }
}
