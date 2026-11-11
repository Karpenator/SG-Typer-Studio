//! indd-utils for SG Typer Studio: one exported conversion, no imports.
//!
//! The host writes the .indd bytes into memory from `alloc`, calls `convert`
//! and reads the result at `result_ptr` / `result_len`, laid out as:
//! u32 status (0 = done, 1 = error), then for an error a UTF-8 message;
//! for a conversion: u32 + IDML package, u32 + warnings (one per line),
//! u32 count of previews, each one u32 + `Self` names (one per line), u32 + data.
//! Every u32 is little-endian.

static mut RESULT: Vec<u8> = Vec::new();

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len)) };
}

fn put(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn convert(ptr: *mut u8, len: usize) -> usize {
    let indd = unsafe { Vec::from_raw_parts(ptr, len, len) };
    let mut out = Vec::new();
    match indd::convert(&indd, "document.indd") {
        Ok(conversion) => {
            out.extend_from_slice(&0u32.to_le_bytes());
            put(&mut out, &conversion.idml);
            let warnings: Vec<&str> = conversion.warnings.iter().map(|w| w.message()).collect();
            put(&mut out, warnings.join("\n").as_bytes());
            out.extend_from_slice(&(conversion.previews.len() as u32).to_le_bytes());
            for preview in &conversion.previews {
                put(&mut out, preview.graphics.join("\n").as_bytes());
                put(&mut out, &preview.data);
            }
        }
        Err(error) => {
            out.extend_from_slice(&1u32.to_le_bytes());
            out.extend_from_slice(error.to_string().as_bytes());
        }
    }
    drop(indd);
    unsafe {
        RESULT = out;
        (*std::ptr::addr_of!(RESULT)).len()
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn result_ptr() -> *const u8 {
    unsafe { (*std::ptr::addr_of!(RESULT)).as_ptr() }
}

#[unsafe(no_mangle)]
pub extern "C" fn result_free() {
    unsafe { RESULT = Vec::new() };
}
