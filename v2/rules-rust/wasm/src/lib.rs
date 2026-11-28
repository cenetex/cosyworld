#![deny(unsafe_code)]

#[cfg(target_arch = "wasm32")]
mod guest {
    use cosyworld_rules::{MAX_JSON_BYTES, MAX_WIRE_BYTES};
    use serde_json::Value;
    use std::{cell::RefCell, str};

    thread_local! {
        static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
        static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }

    fn decode(input: &[u8]) -> Option<Value> {
        if input.first() != Some(&0) {
            return serde_json::from_slice(input).ok();
        }
        let request_len = u32::from_le_bytes(input.get(1..5)?.try_into().ok()?) as usize;
        if !(1..=MAX_JSON_BYTES).contains(&request_len) {
            return None;
        }
        let (request, pack) = input.get(5..)?.split_at_checked(request_len)?;
        if pack.len() > MAX_JSON_BYTES {
            return None;
        }
        let pack = str::from_utf8(pack).ok()?;
        let mut request: Value = serde_json::from_slice(request).ok()?;
        request
            .as_object_mut()?
            .insert("packContentJson".into(), pack.into());
        Some(request)
    }

    #[allow(unsafe_code, reason = "The WASM ABI requires unmangled export names")]
    #[no_mangle]
    pub extern "C" fn supports_raw_pack() -> u32 {
        1
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
            let parsed = decode(input);
            input.clear();
            let result = cosyworld_rules::reduce(&parsed?);
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
